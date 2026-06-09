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
  anomalies: ClassifiedAnomaly[];
  isRed: boolean; // status under|absent OR any structural anomaly
  isYellow: boolean; // status over OR only-possible anomalies (and not red)
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
}

/**
 * Canonical "is this cell red/yellow" classification. Pure. Consumed by
 * both generatePresenzeXlsx (the emailed report) and the review UI so the
 * page and the report can never diverge.
 */
export function classifyDay(args: ClassifyDayArgs): DayClassification {
  const { date, scheduledHours, dailyStats, leaveHours, isNonWorkingDay, isActiveOnDay } = args;

  const workedHours = dailyStats?.hoursWorked ?? 0;
  const effectiveHours = workedHours + leaveHours;

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
      anomalies,
      isRed: false,
      isYellow: false,
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
      anomalies,
      isRed: true,
      isYellow: false,
    };
  }

  let status: DayStatus;
  if (effectiveHours < scheduledHours) status = "under";
  else if (effectiveHours > scheduledHours) status = "over";
  else status = "ok";

  const isRed = status === "under" || hasStructural;
  const isYellow = !isRed && (status === "over" || hasPossible);

  return {
    date,
    status,
    scheduledHours,
    workedHours,
    leaveHours,
    effectiveHours,
    anomalies,
    isRed,
    isYellow,
  };
}

// Re-export the schedule type so callers building args have it handy.
export type { EmployeeScheduleDay };
