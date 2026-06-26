/**
 * Leave amortization predictor — pure planning engine (no DB).
 *
 * Given each enabled employee's residual ferie/ROL, it distributes a unified
 * hour-pool across future working days as whole-day absences, zeroing the
 * residual by year end while avoiding collisions (best-effort: at most one
 * employee off per day, soft-overflowing only when free days run out).
 *
 * Currency model (decision D3): vacation days and ROL hours are merged into a
 * single hour-pool, then spread as WHOLE FERIE days. Vacation contributes whole
 * days directly; its fractional remainder rolls into the ROL pool; whole-day ROL
 * multiples (8h, 16h, …) are booked as ferie days too — never as hourly permits —
 * and only indivisible ROL hours below one working day are accepted scrap.
 *
 * All dates are YYYY-MM-DD strings (Europe/Rome), never Date arithmetic for
 * iteration — mirrors working-days.ts. `now` is injected for deterministic tests.
 */
import { expandToWorkingDays, isWorkingDay, dayOfWeekIso, type ScheduleMap } from "./working-days";
import { CONTRACT_DAILY_HOURS, buildWorkingScheduleMap } from "../employees/schedule-fallback";

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
  type: "VACATION"; // every amortized day is a whole ferie day (see planAmortization)
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

function prevDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Monday (ISO) of the week containing `date`. */
function mondayOf(date: string): string {
  let cur = date;
  for (let i = dayOfWeekIso(date); i > 1; i--) cur = prevDay(cur);
  return cur;
}

/**
 * Contiguous NON-working days (weekend + public holidays) immediately around
 * `date` for this employee — the "leverage" of taking that one ferie day off.
 * A Friday → 2 (Sat+Sun, a 3-day weekend); a day bridging a holiday → 3-4 (a
 * ponte); a plain mid-week day → 0. Drives the long-weekend / ponte preference.
 */
function adjacentFreeRun(date: string, scheduleMap: ScheduleMap): number {
  let count = 0;
  let cur = prevDay(date);
  for (let i = 0; i < 6 && !isWorkingDay(cur, scheduleMap); i++) { count++; cur = prevDay(cur); }
  cur = nextDay(date);
  for (let i = 0; i < 6 && !isWorkingDay(cur, scheduleMap); i++) { count++; cur = nextDay(cur); }
  return count;
}

/**
 * Unify the residual ferie+ROL into a single hour-pool and split it into whole
 * days. Vacation whole days are kept as VACATION; the vacation fraction and the
 * ROL hours form the ROL pool, divided into full ROL days; the indivisible
 * remainder is accepted scrap.
 */
export function computePool(input: EmployeeAmortInput): EmployeePool {
  const dailyH = CONTRACT_DAILY_HOURS[input.contractType] ?? CONTRACT_DAILY_HOURS.FULL_TIME;

  // Unify ferie (days→hours) + ROL (hours) into ONE pool BEFORE clamping. This
  // lets an over-drawn ledger offset the other: once the predictor has booked
  // ferie days funded by ROL, vacationRemaining goes negative while ROL stays
  // full — the unified remainder is still ~0, so "da pianificare" reads 0, not a
  // phantom surplus. (Clamping each side to 0 first would lose that offset.)
  const unifiedHours = r2(input.vacationRemaining * dailyH + input.rolRemaining);
  const poolHours = Math.max(0, unifiedHours);
  const totalDays = Math.floor(poolHours / dailyH);
  const scrapHours = r2(poolHours - totalDays * dailyH);

  // Split for display only: whole ferie days first, the rest attributed to ROL.
  const vacWholeDays = Math.min(totalDays, Math.max(0, Math.floor(Math.max(0, input.vacationRemaining))));
  const rolWholeDays = totalDays - vacWholeDays;

  return { vacWholeDays, rolWholeDays, scrapHours, totalDays, dailyH };
}

function buildScheduleMap(input: EmployeeAmortInput): ScheduleMap {
  return buildWorkingScheduleMap(input.schedule, input.contractType);
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
 * Build the amortization plan for all employees — a REAL spread, not a naive
 * front-fill. A predictor's value is distributing the accumulated pool so it
 * doesn't weigh on the business; therefore:
 *
 *   - leave is spread EVENLY across the weeks remaining in the year (day i → week
 *     ⌊i·W/target⌋), so it spans the whole horizon — never a block of consecutive
 *     days. Normally ≤1 day per working week; ≤2 only when the pool exceeds the
 *     number of weeks left;
 *   - within each chosen week the most VALUABLE working day wins — Fridays and
 *     Mondays (3-day weekends) and days that bridge a public holiday (ponti),
 *     ranked by `adjacentFreeRun`;
 *   - a global day-occupancy penalty rotates those prized Fri/Mon/ponte days
 *     ACROSS employees, so collisions are avoided and everyone shares the long
 *     weekends instead of one person hogging every bridge.
 *
 * Every amortized day is a WHOLE FERIE day (the unified pool already converted
 * ROL hours into whole-day equivalents). Employees are processed in stable id
 * order (deterministic, resumable). When the pool can't fit ≤1-2/week it
 * soft-overflows onto the best remaining days so the residual still zeroes.
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
    const target = computePool(emp).totalDays;
    if (target === 0) {
      result.set(emp.id, []);
      continue;
    }
    const cands = candidateDays(emp, now, yearEnd);
    if (cands.length === 0) {
      result.set(emp.id, []);
      continue;
    }

    const scheduleMap = buildScheduleMap(emp);
    const adj = new Map<string, number>();
    for (const d of cands) adj.set(d, adjacentFreeRun(d, scheduleMap));

    // Anti-collision dominates desirability: any day already taken (this
    // employee's existing leaves + everyone processed before) drops below every
    // free day, so the prized Fri/Mon/ponte days ROTATE across employees instead
    // of one person hogging them. Among equally-loaded days, `adjacentFreeRun`
    // (long weekends / ponti) decides, then the earlier date.
    const score = (d: string) => (adj.get(d) ?? 0) - (occupancy.get(d) ?? 0) * 1000;

    // Group candidates by ISO week (keyed by that week's Monday), chronological.
    const byWeek = new Map<string, string[]>();
    for (const d of cands) {
      const wk = mondayOf(d);
      const arr = byWeek.get(wk);
      if (arr) arr.push(d);
      else byWeek.set(wk, [d]);
    }
    const weeks = [...byWeek.keys()].sort();

    // Spread `target` days evenly across the weeks of the horizon.
    const perWeek = new Array(weeks.length).fill(0) as number[];
    for (let i = 0; i < target; i++) {
      const w = Math.min(weeks.length - 1, Math.floor((i * weeks.length) / target));
      perWeek[w]++;
    }

    const chosen = new Set<string>();
    for (let wi = 0; wi < weeks.length; wi++) {
      const need = perWeek[wi];
      if (need === 0) continue;
      const dayList = [...(byWeek.get(weeks[wi]) ?? [])].sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
      for (let k = 0; k < need && k < dayList.length; k++) {
        const pick = dayList[k];
        // dayList is free-days-first; once we hit an already-taken day the whole
        // week is occupied — don't stack, defer the day to soft-overflow which
        // will place it on a free day elsewhere (better spread, fewer collisions).
        if ((occupancy.get(pick) ?? 0) > 0) break;
        chosen.add(pick);
        occupancy.set(pick, (occupancy.get(pick) ?? 0) + 1);
      }
    }

    // Soft overflow: weeks that ran out of candidate days leave a shortfall — fill
    // it with the best remaining days anywhere in the horizon.
    if (chosen.size < target) {
      const rest = cands.filter((d) => !chosen.has(d)).sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
      for (const d of rest) {
        if (chosen.size >= target) break;
        chosen.add(d);
        occupancy.set(d, (occupancy.get(d) ?? 0) + 1);
      }
    }

    const days = [...chosen].sort().map((date) => ({ date, type: "VACATION" as const }));
    result.set(emp.id, days);
  }
  return result;
}
