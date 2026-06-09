// src/lib/presenze/pre-send-warning.ts

export interface PreSendWarningArgs {
  today: number;        // day-of-month now
  reportDay: number;    // configured monthlyReportDay
  warnLeadDays: number; // how many days before reportDay to warn
  alreadySent: boolean; // lastReportSent === this report month
  redIssueCount: number;
}

/**
 * True when we are within `warnLeadDays` before `reportDay` (but not yet on
 * report day), the report hasn't been sent, and there are unresolved red
 * issues for the month being reported. Pure.
 */
export function shouldWarnPreSend(args: PreSendWarningArgs): boolean {
  const { today, reportDay, warnLeadDays, alreadySent, redIssueCount } = args;
  if (alreadySent) return false;
  if (redIssueCount <= 0) return false;
  const daysUntil = reportDay - today;
  return daysUntil >= 1 && daysUntil <= warnLeadDays;
}
