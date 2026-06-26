"use client";

import { CheckCheck, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";

export interface PlanDay {
  id: string;
  date: string;
  type: string;
  hours: number | null;
  confirmedAt: string | null;
}

export interface PlanEmployee {
  employeeId: string;
  name: string;
  avatarUrl: string | null;
  vacationRemaining: number;
  rolRemaining: number;
  dailyH: number;
  unifiedHours: number;
  pool: { vacWholeDays: number; rolWholeDays: number; scrapHours: number; totalDays: number };
  days: PlanDay[];
}

function fmtDate(d: string): string {
  const [, m, day] = d.split("-");
  return `${parseInt(day)}/${parseInt(m)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-low px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-0.5 text-sm font-extrabold tabular-nums text-on-surface">{value}</p>
    </div>
  );
}

export function PlanByEmployee({
  emp,
  collisionDates,
  busy,
  onConfirm,
  onCancel,
  onConfirmAll,
}: {
  emp: PlanEmployee;
  collisionDates: Set<string>;
  busy: boolean;
  onConfirm: (id: string) => void;
  onCancel: (day: PlanDay) => void;
  onConfirmAll: (emp: PlanEmployee) => void;
}) {
  const confirmed = emp.days.filter((d) => d.confirmedAt).length;
  const toConfirm = emp.days.length - confirmed;

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-surface-container px-5 py-3">
        <h3 className="font-display text-sm font-bold text-on-surface">{emp.name}</h3>
        <div className="flex items-center gap-2">
          {toConfirm > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-container px-2 py-0.5 text-[11px] font-bold text-warning">
              {toConfirm} da confermare
            </span>
          ) : emp.days.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-container px-2 py-0.5 text-[11px] font-bold text-success">
              <CheckCircle2 className="h-3 w-3" /> tutti confermati
            </span>
          ) : null}
          {toConfirm > 0 && (
            <button
              onClick={() => onConfirmAll(emp)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary hover:bg-primary-container disabled:opacity-50"
            >
              <CheckCheck className="h-4 w-4" /> Conferma tutti
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 border-b border-surface-container bg-surface-container-low/30 px-5 py-3 sm:grid-cols-5">
        <Stat label="Residuo ferie" value={`${emp.vacationRemaining} gg`} />
        <Stat label="Residuo ROL" value={`${emp.rolRemaining} h`} />
        <Stat label="Giorni pianificati" value={`${emp.days.length}`} />
        <Stat label="Da pianificare" value={`${emp.pool.totalDays} gg`} />
        <Stat label="Scarto" value={`${emp.pool.scrapHours} h`} />
      </div>

      {/* Days */}
      {emp.days.length === 0 ? (
        <div className="px-5 py-4 text-center text-xs text-on-surface-variant">
          Nessun giorno pianificato. Usa &quot;Ricalcola&quot; per generare il piano.
        </div>
      ) : (
        <ul className="divide-y divide-surface-container-low">
          {emp.days.map((d) => {
            const isCollision = collisionDates.has(d.date);
            return (
              <li key={d.id} className="flex items-center justify-between gap-2 px-5 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-14 text-xs font-semibold tabular-nums text-on-surface">{fmtDate(d.date)}</span>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${d.type === "ROL" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
                    {d.type === "ROL" ? `ROL ${d.hours ?? ""}h` : "Ferie"}
                  </span>
                  {isCollision && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-warning" title="Più dipendenti in ferie in questo giorno">
                      <AlertTriangle className="h-3 w-3" /> collisione
                    </span>
                  )}
                  {d.confirmedAt && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-success">
                      <CheckCircle2 className="h-3 w-3" /> confermato
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!d.confirmedAt && (
                    <button
                      onClick={() => onConfirm(d.id)}
                      disabled={busy}
                      aria-label="Conferma giorno"
                      title="Conferma"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-success hover:bg-success-container disabled:opacity-50"
                    >
                      <CheckCheck className="h-5 w-5" />
                    </button>
                  )}
                  <button
                    onClick={() => onCancel(d)}
                    disabled={busy}
                    aria-label="Cancella giorno"
                    title="Cancella (non goduto)"
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-outline-variant hover:bg-surface-container-high hover:text-error disabled:opacity-50"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
