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

const TYPE_LABELS: Record<string, string> = {
  ENTRY: "Entrata", EXIT: "Uscita", PAUSE_START: "Inizio pausa", PAUSE_END: "Fine pausa",
  OVERTIME_START: "Inizio straordinario", OVERTIME_END: "Fine straordinario",
};
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
  const [editor, setEditor] = useState<{ employeeId: string; employeeName: string; date: string } | null>(null);
  const [editRecords, setEditRecords] = useState<DayRecord[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/presenze/review?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ReviewResponse | null) => setData(d))
      .finally(() => setLoading(false));
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
    if (d.isYellow) return "bg-yellow-300 text-black";
    if (d.status === "non_working") return "bg-surface-container-low text-outline-variant";
    return "bg-surface-container-lowest text-on-surface";
  }

  function openEditor(employeeId: string, employeeName: string, date: string) {
    setEditor({ employeeId, employeeName, date });
    setEditRecords(null);
    fetch(`/api/records?employeeId=${employeeId}&date=${date}`)
      .then((r) => r.json())
      .then((recs: DayRecord[]) => setEditRecords(recs));
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
      toast.success("Modifiche salvate");
      setEditor(null);
      setEditRecords(null);
      load();
    } finally {
      setSaving(false);
    }
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
                        const clickable = c.isRed || c.isYellow || c.status === "absent";
                        return (
                          <td
                            key={d}
                            title={c.anomalies.map((a) => a.description).join("; ") || c.status}
                            className={`px-1 py-1.5 text-center tabular-nums ${cellClass(c)} ${clickable ? "cursor-pointer hover:ring-2 hover:ring-primary" : ""}`}
                            onClick={() => clickable && openEditor(emp.employeeId, emp.displayName, c.date)}
                          >
                            {c.status === "non_working" ? "-" : c.status === "absent" ? "A" : c.effectiveHours || ""}
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

      {/* Day editor modal */}
      {editor && (
        <DayEditorModal
          editor={editor}
          editRecords={editRecords}
          setEditRecords={setEditRecords}
          saving={saving}
          onSave={saveDay}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function DayEditorModal({
  editor,
  editRecords,
  setEditRecords,
  saving,
  onSave,
  onClose,
}: {
  editor: { employeeId: string; employeeName: string; date: string };
  editRecords: DayRecord[] | null;
  setEditRecords: (recs: DayRecord[]) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const modalContentRef = useRef<HTMLDivElement>(null);
  useModalA11y(modalContentRef, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={modalContentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-editor-title"
        className="w-full max-w-lg rounded-lg bg-surface-container-lowest p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="day-editor-title" className="mb-4 text-lg font-semibold">{editor.employeeName} — {formatDateIt(editor.date)}</h3>
        {editRecords === null ? (
          <div className="py-8 text-center text-on-surface-variant">Caricamento...</div>
        ) : (
          <>
            <div className="space-y-2">
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
            <div className="mt-4 flex items-center gap-2">
              <button className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-on-primary disabled:opacity-50" disabled={saving} onClick={onSave}>
                Salva
              </button>
              <button className="rounded-lg border border-outline-variant px-4 py-2 text-xs" onClick={onClose}>Annulla</button>
              <button
                className="ml-auto rounded-lg border border-dashed border-outline-variant px-3 py-2 text-xs"
                onClick={() => setEditRecords([...(editRecords ?? []), { id: `new-${Date.now()}`, type: "ENTRY", declaredTime: "09:00" }])}
              >+ Aggiungi</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
