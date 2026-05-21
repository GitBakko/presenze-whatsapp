/**
 * Pure working-day computation for the leave domain.
 *
 * `ScheduleMap` is built by callers from `EmployeeSchedule` rows.
 * Keys = ISO day of week (1=Mon..7=Sun). Today the schedule table only
 * stores rows for 1..5, so weekend days are absent → automatically excluded.
 * Holidays (national + local San Feliciano) add a second exclusion layer.
 *
 * All inputs are YYYY-MM-DD strings. No `new Date()` arithmetic for
 * iteration to avoid host-timezone drift; we use a UTC-anchored Date
 * at noon to compute day-of-week via Europe/Rome.
 */
import { dowRome } from "../tz";
import { isPublicHoliday } from "./holidays";

export type ScheduleMap = Map<number, unknown>;

/** Day of week in Europe/Rome (1=Mon..7=Sun) for a YYYY-MM-DD string. */
function dayOfWeekIso(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  // Anchor at noon UTC so the Europe/Rome calendar date matches `date`
  // regardless of DST and host TZ.
  return dowRome(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
}

/** Increment a YYYY-MM-DD by one day, returning a YYYY-MM-DD. */
function addOneDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + 1);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** True if the given calendar date counts as a working day for this employee. */
export function isWorkingDay(date: string, scheduleMap: ScheduleMap): boolean {
  const dow = dayOfWeekIso(date);
  if (!scheduleMap.has(dow)) return false;
  if (isPublicHoliday(date)) return false;
  return true;
}

/** Inclusive count of working days between two YYYY-MM-DD strings. */
export function countWorkDays(
  startDate: string,
  endDate: string,
  scheduleMap: ScheduleMap
): number {
  if (startDate > endDate) return 0;
  let count = 0;
  let cur = startDate;
  while (cur <= endDate) {
    if (isWorkingDay(cur, scheduleMap)) count++;
    cur = addOneDay(cur);
  }
  return count;
}

/** Inclusive list of working YYYY-MM-DD dates between two dates. */
export function expandToWorkingDays(
  startDate: string,
  endDate: string,
  scheduleMap: ScheduleMap
): string[] {
  if (startDate > endDate) return [];
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    if (isWorkingDay(cur, scheduleMap)) out.push(cur);
    cur = addOneDay(cur);
  }
  return out;
}
