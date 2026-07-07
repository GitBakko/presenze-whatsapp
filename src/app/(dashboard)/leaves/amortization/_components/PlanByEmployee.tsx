"use client";

import { useMemo } from "react";
import { CheckCheck, Trash2, AlertTriangle, CheckCircle2, CalendarX2, Sparkles, X } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { todayRome } from "@/lib/tz";
import { PREDICTOR_STYLES } from "../../_components/types";

export interface PlanDay {
  id: string;
  date: string;
  type: string;
  hours: number | null;
  confirmedAt: string | null;
}

export interface PlanExclusion {
  id: string;
  date: string;
}

export interface PlanEmployee {
  employeeId: string;
  name: string;
  avatarUrl: string | null;
  vacationRemaining: number;
  rolRemaining: number;
  dailyH: number;
  unifiedHours: number;
  monteTodayDays: number;
  monthlyAccrualDays: number;
  /** Month-by-month unified monte (gg); null before hire month. Index = month-1. */
  trend: (number | null)[];
  pool: { vacWholeDays: number; rolWholeDays: number; scrapHours: number; totalDays: number };
  days: PlanDay[];
  exclusions: PlanExclusion[];
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

/** Compact burn-down of the employee's unified monte across the year. */
function MonteSparkline({
  months,
  trend,
  currentMonthLabel,
}: {
  months: string[];
  trend: (number | null)[];
  currentMonthLabel: string | null;
}) {
  const rows = months.map((mese, i) => ({ mese, monte: trend[i] ?? null }));
  if (rows.length === 0 || rows.every((r) => r.monte === null)) return null;
  return (
    <div aria-label="Andamento mensile del monte ferie e permessi in giorni">
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-container)" vertical={false} />
          <XAxis dataKey="mese" tick={{ fontSize: 10, fill: "var(--color-on-surface-variant)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "var(--color-on-surface-variant)" }} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid var(--color-outline-variant)", fontSize: 12 }}
            formatter={(value) => [`${value} gg`, "monte"]}
          />
          <ReferenceLine y={0} stroke="var(--color-outline-variant)" />
          {currentMonthLabel && (
            <ReferenceLine
              x={currentMonthLabel}
              stroke="var(--color-on-surface-variant)"
              strokeDasharray="4 3"
              label={{ value: "oggi", position: "top", fontSize: 9, fill: "var(--color-on-surface-variant)" }}
            />
          )}
          <Line type="monotone" dataKey="monte" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PlanByEmployee({
  emp,
  months,
  currentMonthLabel,
  collisionDates,
  busy,
  onConfirm,
  onCancel,
  onReschedule,
  onConfirmAll,
  onDeleteAll,
  onRemoveExclusion,
}: {
  emp: PlanEmployee;
  months: string[];
  currentMonthLabel: string | null;
  collisionDates: Set<string>;
  busy: boolean;
  onConfirm: (id: string) => void;
  onCancel: (day: PlanDay) => void;
  onReschedule: (day: PlanDay) => void;
  onConfirmAll: (emp: PlanEmployee) => void;
  onDeleteAll: (emp: PlanEmployee) => void;
  onRemoveExclusion: (exclusion: PlanExclusion) => void;
}) {
  const confirmed = emp.days.filter((d) => d.confirmedAt).length;
  const toConfirm = emp.days.length - confirmed;
  const today = todayRome();
  const futureDays = emp.days.filter((d) => d.date > today).length;

  // Days grouped by month (1-based month number, chronological) so the admin
  // sees the burn-down month by month with the accrual step at each change.
  const byMonth = useMemo(() => {
    const map = new Map<number, PlanDay[]>();
    for (const d of emp.days) {
      const m = parseInt(d.date.slice(5, 7), 10);
      const arr = map.get(m) ?? [];
      arr.push(d);
      map.set(m, arr);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [emp.days]);

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
          {futureDays > 0 && (
            <button
              onClick={() => onDeleteAll(emp)}
              disabled={busy}
              title="Elimina tutti i giorni futuri del predittore (anche confermati)"
              className="inline-flex items-center gap-1 rounded-lg border border-error/40 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error-container/50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Elimina tutti
            </button>
          )}
        </div>
      </div>

      {/* Summary — decision support: current monte, monthly accrual step, year-end residuals */}
      <div className="grid grid-cols-2 gap-3 border-b border-surface-container bg-surface-container-low/30 px-5 py-3 sm:grid-cols-4 xl:grid-cols-7">
        <Stat label="Monte attuale" value={`${emp.monteTodayDays} gg`} />
        <Stat label="Accumulo mese" value={`+${emp.monthlyAccrualDays} gg`} />
        <Stat label="Ferie al 31/12" value={`${emp.vacationRemaining} gg`} />
        <Stat label="ROL al 31/12" value={`${emp.rolRemaining} h`} />
        <Stat label="Pianificati" value={`${emp.days.length}`} />
        <Stat label="Da pianificare" value={`${emp.pool.totalDays} gg`} />
        <Stat label="Scarto" value={`${emp.pool.scrapHours} h`} />
      </div>

      {/* Burn-down: monte per month (accrual up, planned leave down) */}
      <div className="border-b border-surface-container px-5 pb-1 pt-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Andamento monte (gg) — decrescita con il piano
        </p>
        <MonteSparkline months={months} trend={emp.trend} currentMonthLabel={currentMonthLabel} />
      </div>

      {/* Admin-vetoed days */}
      {emp.exclusions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-surface-container px-5 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">Giorni esclusi</span>
          {emp.exclusions.map((x) => (
            <span
              key={x.id}
              className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant"
              title="Il predittore non pianifica su questo giorno"
            >
              <CalendarX2 className="h-3 w-3" /> {fmtDate(x.date)}
              <button
                onClick={() => onRemoveExclusion(x)}
                disabled={busy}
                aria-label={`Rimuovi esclusione ${x.date}`}
                title="Rendi di nuovo pianificabile"
                className="rounded-full p-0.5 hover:bg-surface-container-high hover:text-error disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Days, month by month */}
      {emp.days.length === 0 ? (
        <div className="px-5 py-4 text-center text-xs text-on-surface-variant">
          Nessun giorno pianificato. Usa &quot;Ricalcola&quot; per generare il piano.
        </div>
      ) : (
        byMonth.map(([monthNum, days]) => {
          const label = months[monthNum - 1] ?? String(monthNum);
          const endOfMonthMonte = emp.trend[monthNum - 1];
          // monte-trend snapshots the CURRENT month as-of-today, not month-end.
          const isCurrentMonth = label === currentMonthLabel;
          return (
            <div key={monthNum}>
              <div className="flex items-center justify-between gap-2 bg-surface-container-low/50 px-5 py-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{label}</span>
                <span className="text-[10px] tabular-nums text-on-surface-variant">
                  {days.length} gg pianificati · +{emp.monthlyAccrualDays} gg maturati
                  {endOfMonthMonte != null && <> · monte {isCurrentMonth ? "oggi" : "a fine mese"} ≈ <b>{endOfMonthMonte} gg</b></>}
                </span>
              </div>
              <ul className="divide-y divide-surface-container-low">
                {days.map((d) => {
                  const isCollision = collisionDates.has(d.date);
                  const isFuture = d.date > today;
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-2 px-5 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-14 text-xs font-semibold tabular-nums text-on-surface">{fmtDate(d.date)}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${d.confirmedAt ? PREDICTOR_STYLES.confirmed : PREDICTOR_STYLES.unconfirmed}`}>
                          <Sparkles className="h-3 w-3" /> Ferie
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
                        {isFuture && (
                          <button
                            onClick={() => onReschedule(d)}
                            disabled={busy}
                            aria-label="Rischedula giorno"
                            title="Rischedula (il dipendente non può quel giorno)"
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-outline-variant hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50"
                          >
                            <CalendarX2 className="h-5 w-5" />
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
            </div>
          );
        })
      )}
    </div>
  );
}
