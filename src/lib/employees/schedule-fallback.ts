/**
 * Single source of truth for the "employee has no EmployeeSchedule rows" fallback.
 *
 * Three features must agree on what a schedule-less employee's working week looks
 * like, or they silently diverge — which is exactly what happened: the leave
 * confirmation popup reported N working days while the balance scaled 0, and the
 * Revisione Presenze grid hid the employee entirely (every day fell into the
 * `scheduledHours <= 0` → non_working branch). The three consumers are:
 *   - leave popup     → src/app/api/leaves/preview-days/route.ts
 *   - leave balance   → src/lib/leaves/balance.ts (vacation working-day count)
 *   - presenze report → src/lib/excel-presenze.ts (per-day scheduled hours)
 *
 * Rule (mirrors the long-standing preview-days fallback): a FULL_TIME employee
 * with zero schedule rows is assumed to work Mon-Fri at the contractual daily
 * hours. An employee WITH any schedule row is trusted as-is (an explicitly empty
 * weekday stays non-working). PART_TIME without rows keeps today's behavior (no
 * fallback): no such employee exists and accrual is already 0 for them, so a
 * working-day fallback would only create an accrual/usage asymmetry.
 */

/** Contractual daily hours used by the Mon-Fri fallback, by contract type. */
export const CONTRACT_DAILY_HOURS: Record<string, number> = {
  FULL_TIME: 8,
  PART_TIME: 4,
};

/** ISO weekdays (1=Mon..7=Sun) assumed working under the fallback. */
export const FALLBACK_WORKING_DOWS: readonly number[] = [1, 2, 3, 4, 5];

/** Whether to apply the Mon-Fri fallback for an employee with `rowCount` schedule rows. */
export function appliesScheduleFallback(rowCount: number, contractType: string): boolean {
  return rowCount === 0 && contractType === "FULL_TIME";
}

/**
 * Effective contracted hours for ISO weekday `dowIso` (1=Mon..7=Sun).
 * When `fallback` is set, returns the contractual hours on Mon-Fri and 0 on the
 * weekend; otherwise returns the real per-day hours unchanged.
 */
export function effectiveScheduledHours(
  realHours: number,
  fallback: boolean,
  dowIso: number,
  contractType: string,
): number {
  if (!fallback) return realHours;
  return FALLBACK_WORKING_DOWS.includes(dowIso)
    ? CONTRACT_DAILY_HOURS[contractType] ?? CONTRACT_DAILY_HOURS.FULL_TIME
    : 0;
}
