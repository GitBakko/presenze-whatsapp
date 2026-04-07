"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  CheckCircle, CheckCircle2, HelpCircle, RefreshCw, AlertTriangle,
  Wrench, X, Clock, LogIn, LogOut, Pause, Play,
  Timer, PlusCircle, MinusCircle, Check, ExternalLink, Pencil,
} from "lucide-react";
import Link from "next/link";

interface Anomaly {
  id: string;
  employee: string;
  employeeId: string;
  date: string;
  type: string;
  description: string;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  computed?: boolean;
}

interface ExistingRecord {
  id: string;
  type: string;
  declaredTime: string;
  messageTime: string;
  source: string;
  isManual: boolean;
}

interface ResolveAction {
  kind: "add" | "delete" | "edit";
  type?: string;
  declaredTime?: string;
  recordId?: string;
}

interface RecordEdit {
  type: string;
  declaredTime: string;
}

// Map anomaly types to the corrective action they need
const ANOMALY_CONFIG: Record<string, {
  label: string;
  addType?: string;
  addLabel?: string;
  canDelete?: string[];
  deleteLabel?: string;
}> = {
  MISSING_EXIT: {
    label: "Uscita mancante",
    addType: "EXIT",
    addLabel: "Aggiungi orario di uscita",
  },
  MISSING_ENTRY: {
    label: "Entrata mancante",
    addType: "ENTRY",
    addLabel: "Aggiungi orario di entrata",
  },
  MISMATCHED_PAIRS: {
    label: "Entrate/uscite non corrispondenti",
    addType: "EXIT",
    addLabel: "Aggiungi record mancante",
    canDelete: ["ENTRY", "EXIT"],
    deleteLabel: "Oppure elimina il record in eccesso",
  },
  PAUSE_NO_END: {
    label: "Pausa senza fine",
    addType: "PAUSE_END",
    addLabel: "Aggiungi fine pausa",
  },
  OVERTIME_NO_END: {
    label: "Straordinario senza fine",
    addType: "OVERTIME_END",
    addLabel: "Aggiungi fine straordinario",
  },
  TIME_OVERLAP: {
    label: "Sovrapposizione orari",
  },
  TIME_BLOCK_MISMATCH: {
    label: "Blocco orario incongruente",
  },
};

const TYPE_LABELS: Record<string, string> = {
  ENTRY: "Entrata",
  EXIT: "Uscita",
  PAUSE_START: "Inizio pausa",
  PAUSE_END: "Fine pausa",
  OVERTIME_START: "Inizio straordinario",
  OVERTIME_END: "Fine straordinario",
};

function monthAgoStr() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split("T")[0];
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export default function AnomaliesPage() {
  const [from, setFrom] = useState(monthAgoStr());
  const [to, setTo] = useState(todayStr());
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  // Resolution panel state — holds a snapshot of the anomaly being resolved.
  // For computed anomalies, the `id` is rewritten to the freshly persisted
  // DB id by openResolvePanel before the modal is rendered.
  const [resolvingAnomaly, setResolvingAnomaly] = useState<Anomaly | null>(null);
  const [resolution, setResolution] = useState("");
  const [addTime, setAddTime] = useState("");
  const [addType, setAddType] = useState("");
  const [existingRecords, setExistingRecords] = useState<ExistingRecord[]>([]);
  const [deleteIds, setDeleteIds] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, RecordEdit>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const resolvedParam = showResolved ? "" : "&resolved=false";
    fetch(`/api/anomalies?from=${from}&to=${to}${resolvedParam}`)
      .then((r) => r.json())
      .then(setAnomalies)
      .finally(() => setLoading(false));
  }, [from, to, showResolved]);

  useEffect(() => { load(); }, [load]);

  const openResolvePanel = async (anomaly: Anomaly) => {
    let realId = anomaly.id;

    // Computed anomalies have synthetic ids ("computed-...") and aren't in
    // the DB yet. Persist them as unresolved before opening the modal so the
    // existing PUT /api/anomalies/[id] resolution flow can act on a real row.
    if (anomaly.computed) {
      const res = await fetch("/api/anomalies/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: anomaly.employeeId,
          date: anomaly.date,
          type: anomaly.type,
          description: anomaly.description,
          persistOnly: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        realId = data.id;
      }
    }

    setResolvingAnomaly({ ...anomaly, id: realId, computed: false });
    setResolution("");
    setAddTime("");
    setDeleteIds(new Set());
    setEdits({});
    const config = ANOMALY_CONFIG[anomaly.type];
    setAddType(config?.addType ?? "");

    // Fetch existing records for this employee+date
    const res = await fetch(`/api/anomalies/${realId}`);
    if (res.ok) {
      const records = await res.json();
      setExistingRecords(Array.isArray(records) ? records : []);
    }
  };

  const closePanel = () => {
    setResolvingAnomaly(null);
    setResolution("");
    setAddTime("");
    setAddType("");
    setExistingRecords([]);
    setDeleteIds(new Set());
    setEdits({});
  };

  const startEditRecord = (r: ExistingRecord) => {
    setEdits((prev) => ({
      ...prev,
      [r.id]: { type: r.type, declaredTime: r.declaredTime },
    }));
    // Annulla l'eventuale flag di delete sullo stesso record
    setDeleteIds((prev) => {
      if (!prev.has(r.id)) return prev;
      const next = new Set(prev);
      next.delete(r.id);
      return next;
    });
  };

  const cancelEditRecord = (recordId: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[recordId];
      return next;
    });
  };

  const updateEdit = (recordId: string, patch: Partial<RecordEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [recordId]: { ...prev[recordId], ...patch },
    }));
  };

  const toggleDelete = (recordId: string) => {
    setDeleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  };

  const handleResolve = async (anomaly: Anomaly) => {
    setSubmitting(true);
    const actions: ResolveAction[] = [];

    // Add record action
    if (addTime && addType) {
      actions.push({ kind: "add", type: addType, declaredTime: addTime });
    }

    // Edit record actions — solo se davvero cambiati rispetto all'originale
    let editsApplied = 0;
    for (const [recordId, edit] of Object.entries(edits)) {
      const orig = existingRecords.find((r) => r.id === recordId);
      if (!orig) continue;
      if (orig.type === edit.type && orig.declaredTime === edit.declaredTime) continue;
      if (!/^\d{2}:\d{2}$/.test(edit.declaredTime)) {
        setSubmitting(false);
        toast.error(`Orario non valido per il record ${TYPE_LABELS[orig.type] ?? orig.type}`);
        return;
      }
      actions.push({
        kind: "edit",
        recordId,
        type: edit.type,
        declaredTime: edit.declaredTime,
      });
      editsApplied++;
    }

    // Delete record actions
    for (const recordId of deleteIds) {
      actions.push({ kind: "delete", recordId });
    }

    const resolutionText = [
      resolution,
      addTime ? `Aggiunto ${TYPE_LABELS[addType] ?? addType} alle ${addTime}` : "",
      editsApplied > 0 ? `Modificat${editsApplied > 1 ? "i" : "o"} ${editsApplied} record` : "",
      deleteIds.size > 0 ? `Eliminat${deleteIds.size > 1 ? "i" : "o"} ${deleteIds.size} record` : "",
    ].filter(Boolean).join(" — ");

    const res = await fetch(`/api/anomalies/${anomaly.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolved: true,
        resolution: resolutionText || "Risolta",
        actions,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || `Errore ${res.status}`);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    closePanel();
    toast.success("Anomalia risolta");
    load();
  };

  const handleDismiss = async (anomaly: Anomaly) => {
    setSubmitting(true);
    const res = await fetch("/api/anomalies/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: anomaly.employeeId,
        date: anomaly.date,
        type: anomaly.type,
        description: anomaly.description,
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success("Anomalia segnata come corretta");
    } else {
      toast.error("Errore nel salvataggio");
    }
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="font-display text-3xl font-bold tracking-tight text-primary">Anomalie</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-on-surface-variant">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="rounded accent-primary"
            />
            Mostra risolte
          </label>
          <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-on-surface-variant">Caricamento...</div>
      ) : anomalies.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-lg bg-success-container p-8 text-on-success-container">
          <CheckCircle className="h-6 w-6 text-emerald-500" />
          Nessuna anomalia trovata nel periodo selezionato.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-container bg-surface-container-low">
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Dipendente</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Data</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Problema</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Stato</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Azione</th>
              </tr>
            </thead>
            <tbody>
              {anomalies.map((a) => {
                const isComputed = !!a.computed;
                return (
                <tr
                  key={a.id}
                  className={`border-b border-surface-container transition-colors ${a.resolved ? "bg-surface-container-low/30" : isComputed ? "hover:bg-amber-50/40 dark:hover:bg-amber-950/20" : "hover:bg-error-container/20"}`}
                >
                  <td className="px-4 py-3 font-medium">{a.employee}</td>
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant">{formatDate(a.date)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${a.resolved ? "bg-surface-container text-on-surface-variant" : isComputed ? "border border-amber-300 bg-amber-200 text-amber-950 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-50" : "bg-error-container text-error"}`}>
                      {isComputed
                        ? <AlertTriangle className="h-3.5 w-3.5" />
                        : a.type.includes("MISSING") ? <HelpCircle className="h-3.5 w-3.5" /> : a.type.includes("MISMATCH") ? <RefreshCw className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {a.description}
                    </span>
                    {isComputed && (
                      <span className="ml-2 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-800 dark:text-amber-50">Possibile</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {a.resolved ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success" title={a.resolution ?? ""}>
                        <CheckCircle className="h-3.5 w-3.5" />
                        Risolta
                      </span>
                    ) : isComputed ? (
                      <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">Da verificare</span>
                    ) : (
                      <span className="text-xs font-medium text-error">Aperta</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!a.resolved && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openResolvePanel(a)}
                          disabled={submitting}
                          className="inline-flex items-center gap-1 rounded-md bg-gradient-to-br from-primary to-primary-container px-3 py-1.5 text-xs font-medium text-on-primary transition-shadow hover:shadow-elevated disabled:opacity-50"
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          Risolvi
                        </button>
                        {isComputed && (
                          <>
                            <button
                              onClick={() => handleDismiss(a)}
                              disabled={submitting}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-shadow hover:bg-emerald-700 hover:shadow-elevated disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Corretto
                            </button>
                            <Link
                              href={`/employees/${a.employeeId}?date=${a.date}`}
                              className="inline-flex items-center gap-1 rounded-md bg-surface-container px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Dettaglio
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                    {a.resolved && a.resolution && (
                      <span className="text-xs text-on-surface-variant">{a.resolution}</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Resolution Panel (modal overlay) ── */}
      {resolvingAnomaly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={closePanel}>
          <div
            className="mx-4 w-full max-w-lg rounded-lg bg-surface-container-lowest p-6 shadow-editorial"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-primary">Risolvi anomalia</h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {resolvingAnomaly.employee} — {formatDate(resolvingAnomaly.date)}
                </p>
              </div>
              <button onClick={closePanel} className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Anomaly description */}
            <div className="mb-5 rounded-md bg-error-container/40 px-4 py-3">
              <p className="text-sm font-medium text-error">{resolvingAnomaly.description}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                Tipo: {ANOMALY_CONFIG[resolvingAnomaly.type]?.label ?? resolvingAnomaly.type}
              </p>
            </div>

            {/* Existing records for context */}
            {existingRecords.length > 0 && (
              <div className="mb-5">
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  Record esistenti per questa giornata
                </h3>
                <div className="space-y-1">
                  {existingRecords.map((r) => {
                    const editing = !!edits[r.id];
                    const isDeleted = deleteIds.has(r.id);
                    return (
                      <div
                        key={r.id}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${
                          isDeleted
                            ? "bg-error-container/30 line-through"
                            : editing
                            ? "bg-primary-fixed/20"
                            : "bg-surface-container-low"
                        }`}
                      >
                        <div className="flex flex-1 items-center gap-2">
                          {editing ? (
                            <>
                              <select
                                value={edits[r.id].type}
                                onChange={(e) => updateEdit(r.id, { type: e.target.value })}
                                className="rounded border-0 bg-surface-container-highest px-2 py-1 text-xs focus:ring-1 focus:ring-primary/40"
                              >
                                {Object.keys(TYPE_LABELS).map((t) => (
                                  <option key={t} value={t}>
                                    {TYPE_LABELS[t]}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="time"
                                value={edits[r.id].declaredTime}
                                onChange={(e) => updateEdit(r.id, { declaredTime: e.target.value })}
                                className="w-24 rounded border-0 bg-surface-container-highest px-2 py-1 font-mono text-xs focus:ring-1 focus:ring-primary/40"
                              />
                            </>
                          ) : (
                            <>
                              <span className="inline-flex min-w-[100px] items-center gap-1 text-xs font-medium text-on-surface-variant">
                                {r.type === "ENTRY" ? <LogIn className="h-3.5 w-3.5" /> : r.type === "EXIT" ? <LogOut className="h-3.5 w-3.5" /> : r.type === "PAUSE_START" ? <Pause className="h-3.5 w-3.5" /> : r.type === "PAUSE_END" ? <Play className="h-3.5 w-3.5" /> : <Timer className="h-3.5 w-3.5" />}
                                {TYPE_LABELS[r.type] ?? r.type}
                              </span>
                              <span className="font-mono tabular-nums">{r.declaredTime}</span>
                              {r.isManual && (
                                <span className="rounded bg-primary-fixed/20 px-1.5 py-0.5 text-[10px] text-primary">manuale</span>
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {editing ? (
                            <button
                              type="button"
                              onClick={() => cancelEditRecord(r.id)}
                              className="rounded-md bg-surface-container-high px-2 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest"
                            >
                              Annulla modifica
                            </button>
                          ) : (
                            !isDeleted && (
                              <button
                                type="button"
                                onClick={() => startEditRecord(r)}
                                className="inline-flex items-center gap-1 rounded-md bg-surface-container-high px-2 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest"
                                title="Modifica tipo e/o orario"
                              >
                                <Pencil className="h-3 w-3" />
                                Modifica
                              </button>
                            )
                          )}
                          {!editing && (
                            <button
                              onClick={() => toggleDelete(r.id)}
                              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                                isDeleted
                                  ? "bg-error text-on-error"
                                  : "text-error hover:bg-error-container"
                              }`}
                            >
                              {isDeleted ? "Annulla" : "Elimina"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add missing record */}
            {ANOMALY_CONFIG[resolvingAnomaly.type]?.addType && (
              <div className="mb-5">
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  {ANOMALY_CONFIG[resolvingAnomaly.type]?.addLabel}
                </h3>
                <div className="flex items-center gap-2">
                  {resolvingAnomaly.type === "MISMATCHED_PAIRS" && (
                    <select
                      value={addType}
                      onChange={(e) => setAddType(e.target.value)}
                      className="rounded-md border-0 bg-surface-container-highest px-3 py-2 text-sm focus:ring-1 focus:ring-primary/20"
                    >
                      <option value="ENTRY">Entrata</option>
                      <option value="EXIT">Uscita</option>
                    </select>
                  )}
                  <div className="relative flex-1">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-on-surface-variant" />
                    <input
                      type="time"
                      value={addTime}
                      onChange={(e) => setAddTime(e.target.value)}
                      className="w-full rounded-md border-0 bg-surface-container-highest py-2 pl-10 pr-3 text-sm focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="mb-5">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                Note (opzionale)
              </h3>
              <input
                type="text"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Es: confermato dall'impiegato..."
                className="w-full rounded-md border-0 bg-surface-container-highest px-3 py-2 text-sm focus:ring-1 focus:ring-primary/20"
              />
            </div>

            {/* Actions summary */}
            {(addTime || deleteIds.size > 0 || Object.keys(edits).length > 0) && (
              <div className="mb-5 rounded-md bg-primary-fixed/10 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-primary">Riepilogo azioni</p>
                <ul className="mt-1 space-y-0.5 text-sm text-on-surface-variant">
                  {addTime && (
                    <li className="flex items-center gap-1">
                      <PlusCircle className="h-3.5 w-3.5 text-success" />
                      {TYPE_LABELS[addType] ?? addType} alle {addTime}
                    </li>
                  )}
                  {Object.entries(edits).map(([rid, ed]) => {
                    const orig = existingRecords.find((r) => r.id === rid);
                    if (!orig) return null;
                    if (orig.type === ed.type && orig.declaredTime === ed.declaredTime) return null;
                    return (
                      <li key={rid} className="flex items-center gap-1">
                        <Pencil className="h-3.5 w-3.5 text-primary" />
                        {TYPE_LABELS[orig.type] ?? orig.type} {orig.declaredTime} → {TYPE_LABELS[ed.type] ?? ed.type} {ed.declaredTime}
                      </li>
                    );
                  })}
                  {deleteIds.size > 0 && (
                    <li className="flex items-center gap-1">
                      <MinusCircle className="h-3.5 w-3.5 text-error" />
                      {deleteIds.size} record da eliminare
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Buttons */}
            <div className="flex justify-end gap-2">
              <button
                onClick={closePanel}
                className="rounded-md bg-surface-container px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-high"
              >
                Annulla
              </button>
              <button
                onClick={() => handleResolve(resolvingAnomaly)}
                disabled={submitting || (!addTime && deleteIds.size === 0 && Object.keys(edits).length === 0 && !resolution)}
                className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-br from-primary to-primary-container px-4 py-2 text-sm font-medium text-on-primary transition-shadow hover:shadow-elevated disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {submitting ? "Salvataggio..." : "Conferma e risolvi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}
