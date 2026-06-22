// src/lib/presenze/classify.ts
import type { DailyStats, EmployeeScheduleDay } from "@/lib/calculator";

/**
 * Anomaly types computed live (never persisted), mirrored from
 * src/app/api/anomalies/route.ts. Used to tag an anomaly "possible".
 */
export const COMPUTED_TYPES = new Set(["TIME_BLOCK_MISMATCH", "TIME_OVERLAP"]);

export type DayStatus = "ok" | "under" | "over" | "absent" | "non_working";

export interface ClassifiedAnomaly {
  type: string;
  description: string;
  severity: "structural" | "possible";
}

export interface DayClassification {
  date: string; // YYYY-MM-DD
  status: DayStatus;
  scheduledHours: number; // contracted hours that day (0 on non-working)
  workedHours: number; // calculateDailyStats hoursWorked (0 if no records)
  leaveHours: number; // hours covered by approved leave
  effectiveHours: number; // worked + leave, what's compared to scheduled
  /**
   * UNCAPPED worked + leave for the day. Unlike `effectiveHours` (which mirrors
   * the printed report cell — where buildPresenzeMonthData deliberately caps
   * ordinario so totale never exceeds scheduled), this is the true sum. When it
   * exceeds the daily cap it means a data conflict (e.g. clocked 6h AND took a
   * 4h ROL the same day = 10h on an 8h day) the report would otherwise hide.
   */
  rawEffectiveHours: number;
  /** Daily cap the raw sum is compared against (= scheduledHours; 0 on non-working). */
  dailyCapHours: number;
  /** rawEffectiveHours exceeds dailyCapHours — review-only signal (yellow). */
  exceedsDailyCap: boolean;
  anomalies: ClassifiedAnomaly[];
  isRed: boolean; // status under|absent OR any structural anomaly (review-UI signal)
  isYellow: boolean; // status over OR only-possible anomalies (and not red) (review-UI signal)
  /**
   * Report (xlsx) colors. HOURS-ONLY, anomaly-blind: byte-identical to the legacy
   * inline rule (totale-vs-scheduled). These — NOT isRed/isYellow — drive the emailed
   * presenze cell fill so the report never changes color because of an anomaly that
   * the pre-refactor report ignored. isRed/isYellow stay anomaly-aware for the review UI.
   */
  isReportRed: boolean; // status under|absent (hours-only)
  isReportYellow: boolean; // status over (hours-only, and not report-red)
}

export interface ClassifyDayArgs {
  date: string;
  /** Contracted hours for this specific weekday (0 = not scheduled). */
  scheduledHours: number;
  /** Daily stats from calculateDailyStats, or null if no records that day. */
  dailyStats: DailyStats | null;
  /** Hours covered by approved leave that day (already mapped by caller). */
  leaveHours: number;
  /** Weekend/holiday via isNonWorkingDay(date). */
  isNonWorkingDay: boolean;
  /** Feature 2 isActiveOn(emp, date); false (pre-hire / post-termination) -> non_working. */
  isActiveOnDay: boolean;
  /**
   * UNCAPPED worked + leave for the day, if the caller can compute it (the
   * report builder can, since it knows the raw stats hours and raw leave hours
   * before capping). Omit to default to `effectiveHours` (no overage possible).
   */
  rawEffectiveHours?: number;
  /** Daily cap for the overage check. Omit to default to `scheduledHours`. */
  dailyCapHours?: number;
}

/** Float tolerance: all hour values are roundHalf'd (multiples of 0.5). */
const CAP_EPSILON = 0.01;

/**
 * Canonical "is this cell red/yellow" classification. Pure. Consumed by
 * both generatePresenzeXlsx (the emailed report) and the review UI so the
 * page and the report can never diverge.
 */
export function classifyDay(args: ClassifyDayArgs): DayClassification {
  const { date, scheduledHours, dailyStats, leaveHours, isNonWorkingDay, isActiveOnDay } = args;

  const workedHours = dailyStats?.hoursWorked ?? 0;
  const effectiveHours = workedHours + leaveHours;

  // Uncapped sum + cap for the daily-overage signal. Defaults make the check a
  // no-op (rawEffective == effective, which never exceeds in the capped report).
  const rawEffectiveHours = args.rawEffectiveHours ?? effectiveHours;
  const dailyCapHours = args.dailyCapHours ?? (scheduledHours > 0 ? scheduledHours : 0);

  const anomalies: ClassifiedAnomaly[] = (dailyStats?.anomalies ?? []).map((a) => ({
    type: a.type,
    description: a.description,
    severity: COMPUTED_TYPES.has(a.type) ? "possible" : "structural",
  }));
  const hasStructural = anomalies.some((a) => a.severity === "structural");
  const hasPossible = anomalies.some((a) => a.severity === "possible");

  // Non-working: weekend/holiday, outside active window, or no schedule that day.
  if (isNonWorkingDay || !isActiveOnDay || scheduledHours <= 0) {
    return {
      date,
      status: "non_working",
      scheduledHours: scheduledHours > 0 ? scheduledHours : 0,
      workedHours,
      leaveHours,
      effectiveHours,
      rawEffectiveHours,
      dailyCapHours: 0, // no cap to bust on a non-working day
      exceedsDailyCap: false,
      anomalies,
      isRed: false,
      isYellow: false,
      isReportRed: false,
      isReportYellow: false,
    };
  }

  // Working day with no records and no leave -> unjustified absence (Assumption A1).
  if (dailyStats == null && leaveHours <= 0) {
    return {
      date,
      status: "absent",
      scheduledHours,
      workedHours,
      leaveHours,
      effectiveHours,
      rawEffectiveHours,
      dailyCapHours,
      exceedsDailyCap: false, // no work + no leave -> nothing to exceed
      anomalies,
      isRed: true,
      isYellow: false,
      isReportRed: true, // absent: totale (0) < scheduled -> legacy RED
      isReportYellow: false,
    };
  }

  let status: DayStatus;
  if (effectiveHours < scheduledHours) status = "under";
  else if (effectiveHours > scheduledHours) status = "over";
  else status = "ok";

  const exceedsDailyCap = dailyCapHours > 0 && rawEffectiveHours > dailyCapHours + CAP_EPSILON;

  // exceedsDailyCap is anomaly-like: it must light the cell yellow in the review
  // UI even when the printed (capped) totale lands exactly on scheduled (status
  // "ok"). It never overrides red.
  const isRed = status === "under" || hasStructural;
  const isYellow = !isRed && (status === "over" || hasPossible || exceedsDailyCap);

  // Report (xlsx) colors: HOURS-ONLY, anomaly-blind — the legacy inline rule
  // (totale-vs-scheduled). Anomalies AND the cap-overage signal must NOT change
  // the emailed report's fill (it stays byte-identical to the legacy rule).
  const isReportRed = status === "under";
  const isReportYellow = !isReportRed && status === "over";

  return {
    date,
    status,
    scheduledHours,
    workedHours,
    leaveHours,
    effectiveHours,
    rawEffectiveHours,
    dailyCapHours,
    exceedsDailyCap,
    anomalies,
    isRed,
    isYellow,
    isReportRed,
    isReportYellow,
  };
}

// Re-export the schedule type so callers building args have it handy.
export type { EmployeeScheduleDay };
