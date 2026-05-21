/**
 * Holiday detection for the leave domain.
 *
 * Wraps `src/lib/holidays-it.ts` (Italian national holidays, computed
 * including Easter Monday via Meeus's algorithm) and adds local company
 * holidays. Today the only local holiday is San Feliciano (24 January,
 * patronale Foligno).
 */
import { getItalianHolidays } from "../holidays-it";

/** Local company holidays as "MM-DD" (recurring every year). */
const LOCAL_HOLIDAYS_MMDD = new Set<string>([
  "01-24", // San Feliciano (Foligno)
]);

/**
 * True if the date is a recurring local company holiday.
 * `date` must be in "YYYY-MM-DD" format.
 */
export function isLocalHoliday(date: string): boolean {
  return LOCAL_HOLIDAYS_MMDD.has(date.slice(5));
}

/**
 * True if the date is a non-working holiday (national + local).
 * Does NOT consider weekends — use working-days.ts for that.
 * `date` must be in "YYYY-MM-DD" format.
 */
export function isPublicHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  if (Number.isNaN(year)) return false;
  if (getItalianHolidays(year).has(date)) return true;
  return isLocalHoliday(date);
}
