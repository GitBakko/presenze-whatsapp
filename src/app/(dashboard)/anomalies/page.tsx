"use client";

import { useEffect, useState, useCallback } from "react";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  CheckCircle, CheckCircle2, HelpCircle, RefreshCw, AlertTriangle,
  Wrench, X, Clock, LogIn, LogOut, Pause, Play,
  Timer, PlusCircle, MinusCircle, Check, ExternalLink,
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
  kind: "add" | "delete";
  type?: string;
  declaredTime?: string;
  recordId?: string;
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

  // Resolution panel state
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [addTime, setAddTime] = useState("");
  const [addType, setAddType] = useState("");
  const [existingRecords, setExistingRecords] = useState<ExistingRecord[]>([]);
  const [deleteIds, setDeleteIds] = useState<Set<string>>(new Set());
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
    setResolvingId(anomaly.id);
    setResolution("");
    setAddTime("");
    setDeleteIds(new Set());
    const config = ANOMALY_CONFIG[anomaly.type];
    setAddType(config?.addType ?? "");

    // Fetch existing records for this employee+date
    const res = await fetch(`/api/anomalies/${anomaly.id}`);
    if (res.ok) {
      const records = await res.json();
      setExistingRecords(Array.isArray(records) ? records : []);
    }
  };

  const closePanel = () => {
    setResolvingId(null);
    setResolution("");
    setAddTime("");
    setAddType("");
    setExistingRecords([]);
    setDeleteIds(new Set());
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

    // Delete record actions
    for (const recordId of deleteIds) {
      actions.push({ kind: "delete", recordId });
    }

    const resolutionText = [
      resolution,
      addTime ? `Aggiunto ${TYPE_LABELS[addType] ?? addType} alle ${addTime}` : "",
      deleteIds.size > 0 ? `Eliminat${deleteIds.size > 1 ? "i" : "o"} ${deleteIds.size} record` : "",
    ].filter(Boolean).join(" — ");

    await fetch(`/api/anomalies/${anomaly.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolved: true,
        resolution: resolutionText || "Risolta",
        actions,
      }),
    });

    setSubmitting(false);
    closePanel();
    load();
  };

  const handleDismiss = async (anomaly: Anomaly) => {
    setSubmitting(true);
    await fetch("/api/anomalies/dismiss", {
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
    load();
  };

  const resolvingAnomaly = anomalies.find((a) => a.id === resolvingId);

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
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${a.resolved ? "bg-surface-container text-on-surface-variant" : isComputed ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-error-container text-error"}`}>
                      {isComputed
                        ? <AlertTriangle className="h-3.5 w-3.5" />
                        : a.type.includes("MISSING") ? <HelpCircle className="h-3.5 w-3.5" /> : a.type.includes("MISMATCH") ? <RefreshCw className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {a.description}
                    </span>
                    {isComputed && (
                      <span className="ml-2 rounded bg-amber-100/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Possibile</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {a.resolved ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success" title={a.resolution ?? ""}>
                        <CheckCircle className="h-3.5 w-3.5" />
                        Risolta
                      </span>
                    ) : isComputed ? (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Da verificare</span>
                    ) : (
                      <span className="text-xs font-medium text-error">Aperta</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!a.resolved && !isComputed && (
                      <button
                        onClick={() => openResolvePanel(a)}
                        className="inline-flex items-center gap-1 rounded-md bg-gradient-to-br from-primary to-primary-container px-3 py-1.5 text-xs font-medium text-on-primary transition-shadow hover:shadow-elevated"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        Risolvi
                      </button>
                    )}
                    {!a.resolved && isComputed && (
                      <div className="flex items-center gap-1.5">
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
                    const config = ANOMALY_CONFIG[resolvingAnomaly.type];
                    const canDelete = config?.canDelete?.includes(r.type) ||
                      resolvingAnomaly.type === "MISMATCHED_PAIRS";
                    return (
                      <div
                        key={r.id}
                        className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                          deleteIds.has(r.id)
                            ? "bg-error-container/30 line-through"
                            : "bg-surface-container-low"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-flex min-w-[100px] items-center gap-1 text-xs font-medium text-on-surface-variant">
                            {r.type === "ENTRY" ? <LogIn className="h-3.5 w-3.5" /> : r.type === "EXIT" ? <LogOut className="h-3.5 w-3.5" /> : r.type === "PAUSE_START" ? <Pause className="h-3.5 w-3.5" /> : r.type === "PAUSE_END" ? <Play className="h-3.5 w-3.5" /> : <Timer className="h-3.5 w-3.5" />}
                            {TYPE_LABELS[r.type] ?? r.type}
                          </span>
                          <span className="font-mono tabular-nums">{r.declaredTime}</span>
                          {r.isManual && (
                            <span className="rounded bg-primary-fixed/20 px-1.5 py-0.5 text-[10px] text-primary">manuale</span>
                          )}
                        </div>
                        {canDelete && (
                          <button
                            onClick={() => toggleDelete(r.id)}
                            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                              deleteIds.has(r.id)
                                ? "bg-error text-on-error"
                                : "text-error hover:bg-error-container"
                            }`}
                          >
                            {deleteIds.has(r.id) ? "Annulla" : "Elimina"}
                          </button>
                        )}
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
            {(addTime || deleteIds.size > 0) && (
              <div className="mb-5 rounded-md bg-primary-fixed/10 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-primary">Riepilogo azioni</p>
                <ul className="mt-1 space-y-0.5 text-sm text-on-surface-variant">
                  {addTime && (
                    <li className="flex items-center gap-1">
                      <PlusCircle className="h-3.5 w-3.5 text-success" />
                      {TYPE_LABELS[addType] ?? addType} alle {addTime}
                    </li>
                  )}
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
                disabled={submitting || (!addTime && deleteIds.size === 0 && !resolution)}
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
