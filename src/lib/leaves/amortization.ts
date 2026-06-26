/**
 * Leave amortization predictor — pure planning engine (no DB).
 *
 * Given each enabled employee's residual ferie/ROL, it distributes a unified
 * hour-pool across future working days as whole-day absences, zeroing the
 * residual by year end while avoiding collisions (best-effort: at most one
 * employee off per day, soft-overflowing only when free days run out).
 *
 * Currency model (decision D3): vacation days and ROL hours are merged into a
 * single hour-pool, then spread as WHOLE days. Vacation contributes whole days
 * directly; its fractional remainder rolls into the ROL pool; indivisible ROL
 * hours below one working day are an accepted scrap left as residual.
 *
 * All dates are YYYY-MM-DD strings (Europe/Rome), never Date arithmetic for
 * iteration — mirrors working-days.ts. `now` is injected for deterministic tests.
 */
import { expandToWorkingDays, type ScheduleMap } from "./working-days";
import { CONTRACT_DAILY_HOURS, appliesScheduleFallback, FALLBACK_WORKING_DOWS } from "../employees/schedule-fallback";

export interface EmployeeAmortInput {
  id: string;
  contractType: string;
  schedule: Array<{ dayOfWeek: number; block1Start: string | null; block1End: string | null; block2Start: string | null; block2End: string | null }>;
  terminationDate: Date | null;
  vacationRemaining: number; // days
  rolRemaining: number; // hours
  occupiedDates: Set<string>; // dates already taken by this employee's existing leaves
}

export interface PlannedDay {
  date: string;
  type: "VACATION" | "ROL";
  hours?: number; // set for ROL full-days (= dailyH)
}

export interface EmployeePool {
  vacWholeDays: number;
  rolWholeDays: number;
  scrapHours: number;
  totalDays: number;
  dailyH: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/**
 * Unify the residual ferie+ROL into a single hour-pool and split it into whole
 * days. Vacation whole days are kept as VACATION; the vacation fraction and the
 * ROL hours form the ROL pool, divided into full ROL days; the indivisible
 * remainder is accepted scrap.
 */
export function computePool(input: EmployeeAmortInput): EmployeePool {
  const dailyH = CONTRACT_DAILY_HOURS[input.contractType] ?? CONTRACT_DAILY_HOURS.FULL_TIME;
  const vac = Math.max(0, input.vacationRemaining);
  const rol = Math.max(0, input.rolRemaining);

  const vacWholeDays = Math.floor(vac);
  const fracHours = r2((vac - vacWholeDays) * dailyH);
  const rolPool = r2(rol + fracHours);
  const rolWholeDays = Math.floor(rolPool / dailyH);
  const scrapHours = r2(rolPool - rolWholeDays * dailyH);

  return { vacWholeDays, rolWholeDays, scrapHours, totalDays: vacWholeDays + rolWholeDays, dailyH };
}

function buildScheduleMap(input: EmployeeAmortInput): ScheduleMap {
  const map = new Map<number, unknown>();
  for (const s of input.schedule) map.set(s.dayOfWeek, s);
  if (appliesScheduleFallback(input.schedule.length, input.contractType)) {
    for (const dow of FALLBACK_WORKING_DOWS) {
      map.set(dow, { block1Start: null, block1End: null, block2Start: null, block2End: null });
    }
  }
  return map;
}

/** Candidate working dates (today+1 .. yearEnd) minus holidays, occupied days, and >= terminationDate. */
export function candidateDays(input: EmployeeAmortInput, now: Date, yearEnd: string): string[] {
  const map = buildScheduleMap(input);
  const term = input.terminationDate ? dateStr(input.terminationDate) : null;
  const start = nextDay(dateStr(now));
  if (start > yearEnd) return [];
  return expandToWorkingDays(start, yearEnd, map).filter(
    (d) => !input.occupiedDates.has(d) && (term === null || d < term),
  );
}

/**
 * Build the amortization plan for all employees.
 *
 * Anti-collision (decision D8, soft): a global day-occupancy counter is seeded
 * with everyone's already-occupied dates (existing human leaves). Each employee
 * fills its required whole days choosing the least-loaded candidate dates first,
 * so two employees rarely land on the same day; when free dates run out the
 * counter simply grows (soft overflow) so the residual still zeroes.
 *
 * Employees are processed in stable id order (no randomness → deterministic,
 * resumable).
 */
export function planAmortization(
  employees: EmployeeAmortInput[],
  now: Date,
  yearEnd: string,
): Map<string, PlannedDay[]> {
  const occupancy = new Map<string, number>();
  for (const e of employees) {
    for (const d of e.occupiedDates) occupancy.set(d, (occupancy.get(d) ?? 0) + 1);
  }

  const sorted = [...employees].sort((a, b) => a.id.localeCompare(b.id));
  const result = new Map<string, PlannedDay[]>();

  for (const emp of sorted) {
    const pool = computePool(emp);
    const planned: PlannedDay[] = [];
    if (pool.totalDays === 0) {
      result.set(emp.id, planned);
      continue;
    }
    const cands = candidateDays(emp, now, yearEnd);
    // Rank candidates least-loaded first, tie-break by date ascending.
    const ranked = [...cands].sort((a, b) => {
      const oa = occupancy.get(a) ?? 0;
      const ob = occupancy.get(b) ?? 0;
      return oa !== ob ? oa - ob : a < b ? -1 : 1;
    });
    const chosen = ranked.slice(0, pool.totalDays).sort();
    chosen.forEach((date, i) => {
      const type: "VACATION" | "ROL" = i < pool.vacWholeDays ? "VACATION" : "ROL";
      planned.push(type === "ROL" ? { date, type, hours: pool.dailyH } : { date, type });
      occupancy.set(date, (occupancy.get(date) ?? 0) + 1);
    });
    result.set(emp.id, planned);
  }
  return result;
}
