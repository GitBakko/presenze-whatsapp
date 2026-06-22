// src/app/(dashboard)/presenze/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useModalA11y } from "@/hooks/useModalA11y";
import { formatDateIt } from "@/lib/date-utils";

type DayStatus = "ok" | "under" | "over" | "absent" | "non_working";
interface DayClassification {
  date: string; status: DayStatus; scheduledHours: number; workedHours: number;
  leaveHours: number; effectiveHours: number;
  rawEffectiveHours: number; dailyCapHours: number; exceedsDailyCap: boolean;
  anomalies: { type: string; description: string; severity: "structural" | "possible" }[];
  isRed: boolean; isYellow: boolean;
}
interface ReviewEmployee {
  employeeId: string; name: string; displayName: string;
  days: DayClassification[]; overtimeTotal: number;
}
interface Issue {
  employeeId: string; employeeName: string; date: string; status: DayStatus;
  severity: "red" | "yellow"; reasons: string[]; recordIds: string[];
}
interface ReviewResponse {
  month: string; reportDay: number; reportEnabled: boolean; alreadySent: boolean;
  employees: ReviewEmployee[]; issues: Issue[];
}
interface DayRecord { id: string; type: string; declaredTime: string }
interface DayLeave {
  id: string; type: string; typeLabel: string; unit: "days" | "hours";
  startDate: string; endDate: string; spansMultipleDays: boolean;
  hours: number | null; status: string; version: number;
}
interface DayPayload { records: DayRecord[]; leaves: DayLeave[] }
interface EditorTarget { employeeId: string; employeeName: string; date: string }

const TYPE_LABELS: Record<string, string> = {
  ENTRY: "Entrata", EXIT: "Uscita", PAUSE_START: "Inizio pausa", PAUSE_END: "Fine pausa",
  OVERTIME_START: "Inizio straordinario", OVERTIME_END: "Fine straordinario",
};
// Mirrors LEAVE_TYPES (src/lib/leaves/balance.ts). `unit` decides whether the
// row shows an hours input. Kept in sync manually (small, static catalog).
const LEAVE_TYPE_OPTIONS: { value: string; label: string; unit: "days" | "hours" }[] = [
  { value: "VACATION", label: "Ferie", unit: "days" },
  { value: "VACATION_HALF_AM", label: "Ferie (mattina)", unit: "days" },
  { value: "VACATION_HALF_PM", label: "Ferie (pomeriggio)", unit: "days" },
  { value: "ROL", label: "Permesso orario (ROL)", unit: "hours" },
  { value: "SICK", label: "Malattia", unit: "days" },
  { value: "BEREAVEMENT", label: "Lutto", unit: "hours" },
  { value: "MARRIAGE", label: "Matrimonio", unit: "hours" },
  { value: "LAW_104", label: "L. 104", unit: "hours" },
  { value: "MEDICAL_VISIT", label: "Visita medica", unit: "hours" },
];
const MONTH_NAMES = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

function prevMonthValue(): string {
  const now = new Date();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function PresenzeReviewPage() {
  const [month, setMonth] = useState(prevMonthValue);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyRed, setOnlyRed] = useState(false);
  const [empFilter, setEmpFilter] = useState<string>("");
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [editRecords, setEditRecords] = useState<DayRecord[] | null>(null);
  const [editLeaves, setEditLeaves] = useState<DayLeave[] | null>(null);
  const [saving, setSaving] = useState(false);

  // `silent` keeps the grid in place (no full-page spinner) for post-edit
  // refreshes while the day popup stays open.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    fetch(`/api/presenze/review?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ReviewResponse | null) => setData(d))
      .finally(() => { if (!silent) setLoading(false); });
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const [y, m] = month.split("-").map(Number);
  const nDays = new Date(y, m, 0).getDate();
  const dayCols = useMemo(() => Array.from({ length: nDays }, (_, i) => i + 1), [nDays]);

  const employees = useMemo(() => {
    if (!data) return [];
    let list = data.employees;
    if (empFilter) list = list.filter((e) => e.employeeId === empFilter);
    if (onlyRed) list = list.filter((e) => e.days.some((d) => d.isRed));
    return list;
  }, [data, empFilter, onlyRed]);

  const issues = useMemo(() => {
    if (!data) return [];
    let list = data.issues;
    if (empFilter) list = list.filter((i) => i.employeeId === empFilter);
    if (onlyRed) list = list.filter((i) => i.severity === "red");
    return list;
  }, [data, empFilter, onlyRed]);

  function cellClass(d: DayClassification): string {
    if (d.isRed) return "bg-red-500 text-white";
    if (d.isYellow || d.exceedsDailyCap) return "bg-yellow-300 text-black";
    if (d.status === "non_working") return "bg-surface-container-low text-outline-variant";
    return "bg-surface-container-lowest text-on-surface";
  }

  function cellLabel(d: DayClassification): string {
    if (d.exceedsDailyCap) return String(d.rawEffectiveHours); // show the REAL overage, not the capped totale
    if (d.status === "non_working") return "-";
    if (d.status === "absent") return "A";
    return d.effectiveHours ? String(d.effectiveHours) : "";
  }

  function cellTitle(d: DayClassification): string {
    const parts = d.anomalies.map((a) => a.description);
    if (d.exceedsDailyCap) {
      parts.unshift(`Lavorate + assenze = ${d.rawEffectiveHours}h, oltre il massimo giornaliero (${d.dailyCapHours}h)`);
    }
    return parts.join("; ") || d.status;
  }

  function findCls(employeeId: string, date: string): DayClassification | null {
    const emp = data?.employees.find((e) => e.employeeId === employeeId);
    return emp?.days.find((d) => d.date === date) ?? null;
  }

  const fetchDay = useCallback(async (employeeId: string, date: string): Promise<DayPayload | null> => {
    const res = await fetch(`/api/presenze/review/day?employeeId=${employeeId}&date=${date}`);
    if (!res.ok) return null;
    return res.json();
  }, []);

  // Stable so useModalA11y's effect doesn't tear down / re-focus on every refresh.
  const closeEditor = useCallback(() => setEditor(null), []);

  function openEditor(employeeId: string, employeeName: string, date: string) {
    setEditor({ employeeId, employeeName, date });
    setEditRecords(null);
    setEditLeaves(null);
    fetchDay(employeeId, date).then((d) => {
      setEditRecords(d?.records ?? []);
      setEditLeaves(d?.leaves ?? []);
    });
  }

  async function saveDay() {
    if (!editor || !editRecords) return;
    setSaving(true);
    try {
      const res = await fetch("/api/presenze/review/day", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: editor.employeeId,
          date: editor.date,
          records: editRecords.map((r) => ({
            ...(r.id.startsWith("new-") ? {} : { id: r.id }),
            type: r.type, declaredTime: r.declaredTime,
          })),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e.error || "Errore nel salvataggio");
        return;
      }
      toast.success("Timbrature salvate");
      const d = await fetchDay(editor.employeeId, editor.date);
      setEditRecords(d?.records ?? []);
      load(true); // refresh grid colors under the open popup
    } finally {
      setSaving(false);
    }
  }

  // Day-scoped leave op (add / editDay / removeDay). Returns true on success.
  async function leaveOp(payload: Record<string, unknown>): Promise<boolean> {
    if (!editor) return false;
    const res = await fetch("/api/presenze/review/day/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, employeeId: editor.employeeId, date: editor.date }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      toast.error(e.message || e.error || "Operazione non riuscita");
      return false;
    }
    toast.success("Assenza aggiornata");
    const d = await fetchDay(editor.employeeId, editor.date);
    setEditLeaves(d?.leaves ?? []); // refresh leaves only (preserve unsaved record edits)
    load(true); // refresh grid colors
    return true;
  }

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Revisione Presenze" }]} />

      {/* Month picker + banner */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
        />
        {data && (
          <div className="rounded-lg bg-surface-container-low px-4 py-2 text-sm text-on-surface-variant">
            Report di {MONTH_NAMES[m - 1]} {y} — parte il giorno {data.reportDay}
            {!data.reportEnabled && " · invio disabilitato"}
            {data.alreadySent && " · già inviato"}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyRed} onChange={(e) => setOnlyRed(e.target.checked)} />
          Solo rossi
        </label>
        {data && (
          <select
            value={empFilter}
            onChange={(e) => setEmpFilter(e.target.value)}
            className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
          >
            <option value="">Tutti i dipendenti</option>
            {data.employees.map((e) => (
              <option key={e.employeeId} value={e.employeeId}>{e.displayName}</option>
            ))}
          </select>
        )}
      </div>

      <p className="text-xs text-on-surface-variant">
        Doppio-click su una casella per modificare timbrature e assenze del giorno. Le caselle gialle
        segnalano anche quando ore lavorate + assenze superano il massimo giornaliero.
      </p>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-on-surface-variant">Caricamento...</div>
      ) : !data ? (
        <div className="text-error">Errore nel caricamento dei dati.</div>
      ) : (
        <>
          {/* Grid mirroring the xlsx (employees × days) */}
          <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface-container-low px-3 py-2 text-left">Dipendente</th>
                  {dayCols.map((d) => (
                    <th key={d} className="px-1 py-2 text-center tabular-nums">{d}</th>
                  ))}
                  <th className="px-2 py-2 text-center">Str.</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const byDay = new Map(emp.days.map((d) => [Number(d.date.slice(-2)), d]));
                  return (
                    <tr key={emp.employeeId} className="border-t border-surface-container">
                      <td className="sticky left-0 z-10 bg-surface-container-lowest px-3 py-1.5 font-semibold">{emp.displayName}</td>
                      {dayCols.map((d) => {
                        const c = byDay.get(d);
                        if (!c) return <td key={d} className="px-1 py-1.5 text-center text-outline-variant">·</td>;
                        return (
                          <td
                            key={d}
                            title={cellTitle(c)}
                            className={`select-none cursor-pointer px-1 py-1.5 text-center tabular-nums hover:ring-2 hover:ring-primary ${cellClass(c)} ${c.exceedsDailyCap ? "font-bold ring-1 ring-amber-600" : ""}`}
                            onDoubleClick={() => openEditor(emp.employeeId, emp.displayName, c.date)}
                          >
                            {cellLabel(c)}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-center tabular-nums">{emp.overtimeTotal || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Issue panel */}
          <div className="rounded-lg bg-surface-container-lowest shadow-card">
            <div className="border-b border-surface-container px-4 py-3 font-semibold">
              Incoerenze ({issues.length})
            </div>
            <ul className="divide-y divide-surface-container">
              {issues.map((i) => (
                <li
                  key={`${i.employeeId}-${i.date}`}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-surface-container-low"
                  onClick={() => openEditor(i.employeeId, i.employeeName, i.date)}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${i.severity === "red" ? "bg-red-500" : "bg-yellow-400"}`} />
                  <span className="w-40 font-medium">{i.employeeName}</span>
                  <span className="w-24 tabular-nums">{formatDateIt(i.date)}</span>
                  <span className="text-on-surface-variant">{i.reasons.join(" · ")}</span>
                </li>
              ))}
              {issues.length === 0 && (
                <li className="px-4 py-6 text-center text-on-surface-variant">Nessuna incoerenza per i filtri selezionati.</li>
              )}
            </ul>
          </div>
        </>
      )}

      {/* Day editor modal — cls is re-derived from current `data` on every render,
          so the overage banner updates live as the admin fixes the day. */}
      {editor && (
        <DayEditorModal
          editor={editor}
          cls={findCls(editor.employeeId, editor.date)}
          editRecords={editRecords}
          setEditRecords={setEditRecords}
          editLeaves={editLeaves}
          saving={saving}
          onSaveRecords={saveDay}
          onLeaveOp={leaveOp}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}

function DayEditorModal({
  editor,
  cls,
  editRecords,
  setEditRecords,
  editLeaves,
  saving,
  onSaveRecords,
  onLeaveOp,
  onClose,
}: {
  editor: EditorTarget;
  cls: DayClassification | null;
  editRecords: DayRecord[] | null;
  setEditRecords: (recs: DayRecord[]) => void;
  editLeaves: DayLeave[] | null;
  saving: boolean;
  onSaveRecords: () => void;
  onLeaveOp: (payload: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const modalContentRef = useRef<HTMLDivElement>(null);
  useModalA11y(modalContentRef, onClose);

  // Per-leave draft (type + hours). MERGE, don't replace, on refresh: seed only
  // newly-arrived leave ids and drop vanished ones, so an unsaved edit on a
  // sibling row survives another row's save (which refetches the whole list).
  const [draft, setDraft] = useState<Record<string, { type: string; hours: string }>>({});
  useEffect(() => {
    if (!editLeaves) return;
    setDraft((prev) => {
      const next = { ...prev };
      for (const l of editLeaves) {
        if (!(l.id in next)) next[l.id] = { type: l.type, hours: l.hours != null ? String(l.hours) : "" };
      }
      for (const k of Object.keys(next)) {
        if (!editLeaves.some((l) => l.id === k)) delete next[k];
      }
      return next;
    });
  }, [editLeaves]);

  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState("VACATION");
  const [addHours, setAddHours] = useState("");
  const [busy, setBusy] = useState(false);

  function unitOf(type: string): "days" | "hours" {
    return LEAVE_TYPE_OPTIONS.find((o) => o.value === type)?.unit ?? "days";
  }

  async function run(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      return await onLeaveOp(payload);
    } finally {
      setBusy(false);
    }
  }

  async function saveLeaveRow(l: DayLeave) {
    const d = draft[l.id];
    if (!d) return;
    const unit = unitOf(d.type);
    const hours = unit === "hours" ? Number(d.hours) : null;
    if (unit === "hours" && (!Number.isFinite(hours!) || hours! <= 0)) {
      toast.error("Inserisci ore valide");
      return;
    }
    await run({ op: "editDay", leaveId: l.id, type: d.type, hours });
  }

  async function addLeave() {
    const unit = unitOf(addType);
    const hours = unit === "hours" ? Number(addHours) : null;
    if (unit === "hours" && (!Number.isFinite(hours!) || hours! <= 0)) {
      toast.error("Inserisci ore valide");
      return;
    }
    const ok = await run({ op: "add", type: addType, hours });
    if (ok) { setAdding(false); setAddType("VACATION"); setAddHours(""); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={modalContentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-editor-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface-container-lowest p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="day-editor-title" className="mb-1 text-lg font-semibold">{editor.employeeName} — {formatDateIt(editor.date)}</h3>

        {cls?.exceedsDailyCap && (
          <div className="mb-4 rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            ⚠ Ore lavorate + assenze = <strong>{cls.rawEffectiveHours}h</strong>, oltre il massimo
            giornaliero di <strong>{cls.dailyCapHours}h</strong>. Correggi timbrature o assenze qui sotto.
          </div>
        )}

        {/* ── Timbrature ─────────────────────────────────────────── */}
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Timbrature</div>
        {editRecords === null ? (
          <div className="py-4 text-center text-on-surface-variant">Caricamento...</div>
        ) : (
          <>
            <div className="space-y-2">
              {editRecords.length === 0 && (
                <p className="text-xs text-on-surface-variant">Nessuna timbratura per questo giorno.</p>
              )}
              {editRecords.map((rec, idx) => (
                <div key={rec.id} className="flex items-center gap-2">
                  <select
                    value={rec.type}
                    onChange={(e) => {
                      const u = [...editRecords]; u[idx] = { ...rec, type: e.target.value }; setEditRecords(u);
                    }}
                    className="rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs"
                  >
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input
                    type="time"
                    value={rec.declaredTime}
                    onChange={(e) => {
                      const u = [...editRecords]; u[idx] = { ...rec, declaredTime: e.target.value }; setEditRecords(u);
                    }}
                    className="rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs tabular-nums"
                  />
                  <button
                    className="ml-auto rounded-full p-1 text-outline-variant hover:text-error"
                    onClick={() => setEditRecords(editRecords.filter((_, j) => j !== idx))}
                  >✕</button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-on-primary disabled:opacity-50" disabled={saving} onClick={onSaveRecords}>
                Salva timbrature
              </button>
              <button
                className="ml-auto rounded-lg border border-dashed border-outline-variant px-3 py-2 text-xs"
                onClick={() => setEditRecords([...(editRecords ?? []), { id: `new-${Date.now()}`, type: "ENTRY", declaredTime: "09:00" }])}
              >+ Aggiungi timbratura</button>
            </div>
          </>
        )}

        {/* ── Assenze (ferie / ROL / malattia / …) ───────────────── */}
        <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Assenze</div>
        {editLeaves === null ? (
          <div className="py-4 text-center text-on-surface-variant">Caricamento...</div>
        ) : (
          <>
            <div className="space-y-3">
              {editLeaves.length === 0 && (
                <p className="text-xs text-on-surface-variant">Nessuna assenza per questo giorno.</p>
              )}
              {editLeaves.map((l) => {
                const d = draft[l.id] ?? { type: l.type, hours: l.hours != null ? String(l.hours) : "" };
                const unit = unitOf(d.type);
                return (
                  <div key={l.id} className="rounded-lg border border-surface-container p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={d.type}
                        onChange={(e) => setDraft({ ...draft, [l.id]: { ...d, type: e.target.value } })}
                        className="rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs"
                      >
                        {LEAVE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {unit === "hours" && (
                        <input
                          type="number" min="0" max="24" step="0.5" placeholder="ore"
                          value={d.hours}
                          onChange={(e) => setDraft({ ...draft, [l.id]: { ...d, hours: e.target.value } })}
                          className="w-20 rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs tabular-nums"
                        />
                      )}
                      {l.status !== "APPROVED" && (
                        <span className="rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] uppercase text-on-surface-variant">{l.status}</span>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary disabled:opacity-50"
                          disabled={busy} onClick={() => saveLeaveRow(l)}
                        >Salva</button>
                        <button
                          className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs text-error disabled:opacity-50"
                          disabled={busy} onClick={() => run({ op: "removeDay", leaveId: l.id })}
                        >Rimuovi giorno</button>
                      </div>
                    </div>
                    {l.spansMultipleDays && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        ⚠ Copre dal {formatDateIt(l.startDate)} al {formatDateIt(l.endDate)} — la modifica
                        agisce solo su questo giorno (il resto resta invariato).
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {adding ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-outline-variant p-2">
                <select
                  value={addType}
                  onChange={(e) => setAddType(e.target.value)}
                  className="rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs"
                >
                  {LEAVE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {unitOf(addType) === "hours" && (
                  <input
                    type="number" min="0" max="24" step="0.5" placeholder="ore"
                    value={addHours}
                    onChange={(e) => setAddHours(e.target.value)}
                    className="w-20 rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs tabular-nums"
                  />
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary disabled:opacity-50" disabled={busy} onClick={addLeave}>Aggiungi</button>
                  <button className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs" onClick={() => setAdding(false)}>Annulla</button>
                </div>
              </div>
            ) : (
              <button
                className="mt-3 rounded-lg border border-dashed border-outline-variant px-3 py-2 text-xs"
                onClick={() => setAdding(true)}
              >+ Aggiungi assenza</button>
            )}
          </>
        )}

        <div className="mt-6 flex justify-end">
          <button className="rounded-lg border border-outline-variant px-4 py-2 text-xs" onClick={onClose}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
