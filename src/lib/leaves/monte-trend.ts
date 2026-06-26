/**
 * Monte ferie/permessi trend — month-by-month evolution of each employee's
 * residual leave pool, expressed in WHOLE DAYS (ROL hours converted at ore/8).
 *
 * "Residuo monte" here is the AS-OF residual: it counts only goduto (past)
 * consumption at each month-end, never future-approved leaves — so the line is a
 * true burn-down of what was actually available, not a projection. The unified
 * value merges ferie (days) and ROL (hours/8) into one figure, per the agreed
 * currency model.
 *
 * Pure (no DB): callers pass already-fetched per-employee data. `now` is injected
 * for deterministic tests. Dates use local Date at noon to match balance.ts.
 */
import {
  computeLeaveBalanceFromData,
  type EmployeeForBalance,
  type BalanceAdjustments,
  type ApprovedLeaveRow,
} from "./balance";

/** Italian month abbreviations, 1-based (index 0 unused). */
const MESI_ABBR = ["", "Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

/** Hours→days divisor for the unified pool (a working day = 8h). */
export const MONTE_DAILY_DIVISOR = 8;

export interface MonteTrendEmployeeInput {
  id: string;
  name: string;
  employee: EmployeeForBalance;
  balance: BalanceAdjustments | null;
  leaves: ApprovedLeaveRow[];
}

export interface MonteTrendSeries {
  employeeId: string;
  name: string;
  /** Residual monte in days per month; null before the employee's hire month. */
  points: (number | null)[];
}

export interface MonteTrend {
  /** Month labels ("Gen".."Dic") up to the current month of `year`. */
  months: string[];
  series: MonteTrendSeries[];
  /** Company total per month = sum of non-null employee points. */
  total: number[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Last day of 1-based month `m` in `year`, at local noon. */
function endOfMonth(year: number, m: number): Date {
  return new Date(year, m, 0, 12, 0, 0);
}

/**
 * How many months of `year` to plot:
 *   - past year → all 12,
 *   - current year → up to the current month,
 *   - future year → none.
 */
function monthsToPlot(year: number, now: Date): number {
  if (year < now.getFullYear()) return 12;
  if (year > now.getFullYear()) return 0;
  return now.getMonth() + 1;
}

export function computeMonteTrend(
  employees: MonteTrendEmployeeInput[],
  year: number,
  now: Date = new Date(),
): MonteTrend {
  const lastMonth = monthsToPlot(year, now);
  const months: string[] = [];
  for (let m = 1; m <= lastMonth; m++) months.push(MESI_ABBR[m]);

  const total = new Array(lastMonth).fill(0) as number[];
  const isCurrentYear = year === now.getFullYear();

  const series: MonteTrendSeries[] = employees.map((e) => {
    const points: (number | null)[] = [];
    for (let m = 1; m <= lastMonth; m++) {
      // Snapshot at the end of month m, but never beyond the real "now" for the
      // ongoing month (so the current point is genuinely as-of-today).
      const snapshot = isCurrentYear && m === now.getMonth() + 1 ? now : endOfMonth(year, m);

      // Before the employee was hired → no monte yet.
      if (e.employee.hireDate && new Date(e.employee.hireDate) > snapshot) {
        points.push(null);
        continue;
      }

      const bal = computeLeaveBalanceFromData(e.employee, e.balance, e.leaves, year, snapshot);
      const monteDays = round2(bal.vacationRemainingAsOfToday + bal.rolRemainingAsOfToday / MONTE_DAILY_DIVISOR);
      points.push(monteDays);
      total[m - 1] = round2(total[m - 1] + monteDays);
    }
    return { employeeId: e.id, name: e.name, points };
  });

  return { months, series, total };
}
