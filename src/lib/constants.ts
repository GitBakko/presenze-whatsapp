/** Standard work schedule */
export const WORK_SCHEDULE = {
  morning: { start: "09:00", end: "13:00" },
  afternoon: { start: "14:30", end: "18:30" },
} as const;

/** Total expected hours per day */
export const EXPECTED_HOURS_PER_DAY = 8;

/** Delay tolerance in minutes (arrival within this window is not considered late) */
export const DELAY_TOLERANCE_MINUTES = 15;

/** Lunch break detection window */
export const LUNCH_BREAK = {
  exitAfter: "13:00",
  exitBefore: "14:00",
  entryAfter: "14:00",
  entryBefore: "15:00",
} as const;
