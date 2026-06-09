# Revisione Presenze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin end-of-month attendance review/edit page that renders the exact data the auto-emailed xlsx will contain, surfaces every incoherence ("rosso"), and lets the admin fix the real `AttendanceRecord` rows safely (transactional batch + audit) before the report fires.

**Architecture:** A pure `classifyDay` function becomes the single source of truth for "is this cell red/yellow/absent"; `buildPresenzeMonthData` computes one `DayClassification` per (employee, day) and `generatePresenzeXlsx` reads `isRed`/`isYellow` from it — byte-identical sheet, guaranteeing page == report. A new `AttendanceRecordEdit` audit model + a shared `recomputeAnomaliesForDates` helper + a transactional batch day endpoint close the POST/DELETE recompute gap and the N-parallel-PUT race. The review API and page sit on top of the refactored builder.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 6 + SQLite, NextAuth v5, vitest, Tailwind 4.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src/lib/presenze/classify.ts` | Create | Pure `classifyDay` + `DayStatus`/`DayClassification` types + `COMPUTED_TYPES` set. Canonical red/yellow/absent rule. |
| `src/lib/presenze/classify.test.ts` | Create | Exhaustive unit tests for every `classifyDay` branch. |
| `src/lib/excel-presenze.ts` | Modify | `buildPresenzeMonthData` computes `classifications: Map<number, DayClassification>` per employee (via `classifyDay`) + `isActiveOnDay` from Feature 2; `generatePresenzeXlsx` reads `isRed`/`isYellow` from it instead of inlining the totale comparison. |
| `src/lib/excel-presenze.classify.test.ts` | Create | Regression test: classification-derived colors equal the legacy inline-comparison colors for a fixture month. |
| `prisma/schema.prisma` | Modify | Add `AttendanceRecordEdit` model + `User.recordEdits` back-relation. |
| `src/lib/attendance/recompute.ts` | Create | Exported `recomputeAnomaliesForDates` (extracted from `records/[id]/route.ts`) + pure `computeRecordDiff` + `WATCHED_RECORD_FIELDS`. |
| `src/lib/attendance/recompute.test.ts` | Create | Unit tests for `computeRecordDiff`. |
| `src/lib/attendance/review-day.ts` | Create | Pure `planDayBatch` (diff submitted records vs existing → create/update/delete plan + collision detection). |
| `src/lib/attendance/review-day.test.ts` | Create | Unit tests for `planDayBatch`. |
| `src/app/api/records/[id]/route.ts` | Modify | PUT/DELETE use shared `recomputeAnomaliesForDates`; DELETE now also recomputes + audits; PUT audits. |
| `src/app/api/records/route.ts` | Modify | POST recomputes anomalies + writes audit row. |
| `src/app/api/presenze/review/day/route.ts` | Create | `PUT` batch day endpoint: transactional create/update/delete + 409 + audit + single recompute + one bus event. Thin wrapper over `planDayBatch`. |
| `src/lib/presenze/issues.ts` | Create | Pure `flattenIssues(employees)` → `Issue[]` + `Issue` type. |
| `src/lib/presenze/issues.test.ts` | Create | Unit tests for `flattenIssues`. |
| `src/app/api/presenze/review/route.ts` | Create | `GET ?month=YYYY-MM` admin endpoint. Thin wrapper: builds month data, maps to response, calls `flattenIssues`. |
| `src/app/(dashboard)/presenze/page.tsx` | Create | Review page UI: month picker, xlsx-mirror grid, issue panel, day editor, report banner. |
| `src/components/Sidebar.tsx` | Modify | Add "Revisione Presenze" admin nav link. |
| `src/lib/presenze/pre-send-warning.ts` | Create | Pure `shouldWarnPreSend(args)` predicate. |
| `src/lib/presenze/pre-send-warning.test.ts` | Create | Unit tests for `shouldWarnPreSend`. |
| `src/lib/monthly-report-worker.ts` | Modify | Hourly tick: N days before reportDay, if red issues remain, publish a `notificationsBus` heads-up. |

---

### Task 1: Pure `classifyDay`

**Files:**
- Create: `src/lib/presenze/classify.ts`
- Test: `src/lib/presenze/classify.test.ts`

This task depends on the `DailyStats`/`AnomalyItem`/`EmployeeScheduleDay` types from `src/lib/calculator.ts` (lines 8-58) and reuses the `scheduledHoursForDay` semantics. `classifyDay` is **pure** — all DB-derived inputs are passed in. `COMPUTED_TYPES` mirrors `src/app/api/anomalies/route.ts:9` (`TIME_BLOCK_MISMATCH`, `TIME_OVERLAP`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/presenze/classify.test.ts
import { describe, it, expect } from "vitest";
import { classifyDay, COMPUTED_TYPES, type ClassifyDayArgs } from "./classify";
import type { DailyStats } from "@/lib/calculator";

function statsWith(partial: Partial<DailyStats>): DailyStats {
  return {
    employeeId: "emp_1",
    employeeName: "Mario Rossi",
    date: "2026-05-04",
    hoursWorked: 0,
    hoursWorkedMsg: 0,
    pauseMinutes: 0,
    pauses: [],
    morningDelay: 0,
    afternoonDelay: 0,
    overtime: 0,
    overtimeBlocks: [],
    hasAnomaly: false,
    anomalies: [],
    entries: [],
    exits: [],
    ...partial,
  };
}

const base: ClassifyDayArgs = {
  date: "2026-05-04", // a Monday
  scheduledHours: 8,
  dailyStats: null,
  leaveHours: 0,
  isNonWorkingDay: false,
  isActiveOnDay: true,
};

describe("classifyDay", () => {
  it("COMPUTED_TYPES contains exactly the live anomaly types", () => {
    expect([...COMPUTED_TYPES].sort()).toEqual(["TIME_BLOCK_MISMATCH", "TIME_OVERLAP"]);
  });

  it("non-working day (weekend/holiday) is non_working and never red", () => {
    const c = classifyDay({ ...base, isNonWorkingDay: true, scheduledHours: 0 });
    expect(c.status).toBe("non_working");
    expect(c.isRed).toBe(false);
    expect(c.isYellow).toBe(false);
  });

  it("outside active window (isActiveOnDay=false) is non_working, never absent", () => {
    const c = classifyDay({ ...base, isActiveOnDay: false });
    expect(c.status).toBe("non_working");
    expect(c.isRed).toBe(false);
  });

  it("zero scheduled hours on a working calendar day is non_working", () => {
    const c = classifyDay({ ...base, scheduledHours: 0 });
    expect(c.status).toBe("non_working");
    expect(c.isRed).toBe(false);
  });

  it("working day, no records, no leave -> absent (red)", () => {
    const c = classifyDay({ ...base, dailyStats: null, leaveHours: 0 });
    expect(c.status).toBe("absent");
    expect(c.isRed).toBe(true);
    expect(c.isYellow).toBe(false);
    expect(c.workedHours).toBe(0);
    expect(c.effectiveHours).toBe(0);
  });

  it("working day fully covered by full-day leave -> ok (not red)", () => {
    const c = classifyDay({ ...base, dailyStats: null, leaveHours: 8 });
    expect(c.status).toBe("ok");
    expect(c.isRed).toBe(false);
    expect(c.effectiveHours).toBe(8);
  });

  it("worked < scheduled -> under (red)", () => {
    const c = classifyDay({ ...base, dailyStats: statsWith({ hoursWorked: 6 }) });
    expect(c.status).toBe("under");
    expect(c.isRed).toBe(true);
    expect(c.effectiveHours).toBe(6);
  });

  it("worked + leave == scheduled -> ok", () => {
    const c = classifyDay({ ...base, dailyStats: statsWith({ hoursWorked: 4 }), leaveHours: 4 });
    expect(c.status).toBe("ok");
    expect(c.isRed).toBe(false);
    expect(c.isYellow).toBe(false);
  });

  it("worked > scheduled -> over (yellow)", () => {
    const c = classifyDay({ ...base, dailyStats: statsWith({ hoursWorked: 9.5 }) });
    expect(c.status).toBe("over");
    expect(c.isRed).toBe(false);
    expect(c.isYellow).toBe(true);
  });

  it("structural anomaly forces isRed even when hours match", () => {
    const stats = statsWith({
      hoursWorked: 8,
      hasAnomaly: true,
      anomalies: [{ type: "MISSING_EXIT", description: "Entrata senza uscita" }],
    });
    const c = classifyDay({ ...base, dailyStats: stats });
    expect(c.status).toBe("ok");
    expect(c.isRed).toBe(true);
    expect(c.anomalies).toEqual([
      { type: "MISSING_EXIT", description: "Entrata senza uscita", severity: "structural" },
    ]);
  });

  it("only-possible anomalies on an ok day -> yellow, not red", () => {
    const stats = statsWith({
      hoursWorked: 8,
      hasAnomaly: true,
      anomalies: [{ type: "TIME_OVERLAP", description: "Uscita 1 prima di Entrata 1" }],
    });
    const c = classifyDay({ ...base, dailyStats: stats });
    expect(c.isRed).toBe(false);
    expect(c.isYellow).toBe(true);
    expect(c.anomalies[0].severity).toBe("possible");
  });

  it("possible anomaly does NOT override an under day's red", () => {
    const stats = statsWith({
      hoursWorked: 5,
      hasAnomaly: true,
      anomalies: [{ type: "TIME_BLOCK_MISMATCH", description: "Entrata pomeriggio in orario mattutino" }],
    });
    const c = classifyDay({ ...base, dailyStats: stats });
    expect(c.status).toBe("under");
    expect(c.isRed).toBe(true);
    expect(c.isYellow).toBe(false);
  });

  it("partial work + half-day leave reaching scheduled -> ok", () => {
    const c = classifyDay({ ...base, dailyStats: statsWith({ hoursWorked: 4 }), leaveHours: 4 });
    expect(c.status).toBe("ok");
    expect(c.isRed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/lib/presenze/classify.test.ts`
  Expected: FAIL — `classify.ts` does not exist (module resolution error / `classifyDay is not a function`).

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/lib/presenze/classify.test.ts`
  Expected: PASS (all 13 cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/presenze/classify.ts src/lib/presenze/classify.test.ts && git commit -m "feat(presenze): pure classifyDay with exhaustive TDD (revisione task 1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Refactor `buildPresenzeMonthData` + `generatePresenzeXlsx` onto `classifyDay`

**Files:**
- Modify: `src/lib/excel-presenze.ts` (types `PresenzeEmployeeData` ~33-39; `buildPresenzeMonthData` ~377-552; `generatePresenzeXlsx` cell loop ~279-325)
- Test: `src/lib/excel-presenze.classify.test.ts`

The builder already derives, per (employee, day): `hoursWorked` (from `hoursMap`), `scheduledHours` (from `scheduledHoursForDay`), and the leave (`leaveMap`). We add a `leaveHours` derivation (the hours the leave covers that day) and a per-day `classifyDay` call, storing results on `PresenzeEmployeeData.classifications: Map<number, DayClassification>`. The existing O/F-P values (`days`, `straordinari`, `scheduledHoursPerDay`) are **unchanged**. `generatePresenzeXlsx` then reads `isRed`/`isYellow` from the classification.

> **Feature 2 dependency:** `buildPresenzeMonthData` already imports/uses `isActiveOn` from `src/lib/employees/active.ts` and the `activeOnWhere` filter (added by Fine Rapporto, implemented first). This task computes `isActiveOnDay = isActiveOn(emp, dateStr)` per (employee, day) and passes it to `classifyDay`. If `isActiveOn` is not yet present in the tree, add a local `const isActiveOnDay = true;` placeholder ONLY as a temporary unblock and leave a `// TODO(fine-rapporto)` — but the canonical assumption is Feature 2 landed first.

- [ ] **Step 1: Write the failing regression test**

This test reconstructs the **legacy** inline color rule (lines 309-323) and asserts the new classification-derived `isRed`/`isYellow` match it cell-for-cell, for a synthetic month built directly from `PresenzeEmployeeData` (no DB). It imports the soon-to-exist `classifyEmployeeDays` helper that wraps the per-day classification using the same inputs the xlsx loop has.

```ts
// src/lib/excel-presenze.classify.test.ts
import { describe, it, expect } from "vitest";
import { isNonWorkingDay } from "@/lib/holidays-it";
import type { PresenzeEmployeeData } from "./excel-presenze";

/**
 * Legacy inline rule, copied verbatim from the pre-refactor xlsx cell loop:
 *   coloring gated on scheduledHoursDay > 0
 *   totale = (oreOrdinario ?? 0) + (oreFuoriSede ?? 0)
 *   totale < scheduled  -> RED
 *   totale > scheduled  -> YELLOW
 *   else                -> no fill
 *   non-working days    -> never colored
 */
function legacyColor(
  emp: PresenzeEmployeeData,
  d: number,
  dateStr: string,
): "red" | "yellow" | null {
  if (isNonWorkingDay(dateStr)) return null;
  const scheduledHoursDay = emp.scheduledHoursPerDay.get(d) ?? 0;
  if (scheduledHoursDay <= 0) return null;
  const dayData = emp.days.get(d);
  const totale = (dayData?.oreOrdinario ?? 0) + (dayData?.oreFuoriSede ?? 0);
  if (totale < scheduledHoursDay) return "red";
  if (totale > scheduledHoursDay) return "yellow";
  return null;
}

// Build a single-employee fixture month exercising every branch.
function fixtureEmployee(): PresenzeEmployeeData {
  const days = new Map<number, { oreOrdinario: number | null; oreFuoriSede: number | null }>();
  const scheduledHoursPerDay = new Map<number, number>();
  // 2026-05-04 Mon under (6 < 8), 05 Tue exact (8), 06 Wed over (9), 07 Thu absent (no data)
  scheduledHoursPerDay.set(4, 8); days.set(4, { oreOrdinario: 6, oreFuoriSede: null });
  scheduledHoursPerDay.set(5, 8); days.set(5, { oreOrdinario: 8, oreFuoriSede: null });
  scheduledHoursPerDay.set(6, 8); days.set(6, { oreOrdinario: 9, oreFuoriSede: null });
  scheduledHoursPerDay.set(7, 8); // no days entry -> absent/red under legacy (totale 0 < 8)
  return {
    displayName: "ROSSI MARIO",
    contractType: "FULL_TIME",
    days,
    straordinari: 1,
    scheduledHoursPerDay,
    // classifications is added by the refactor; cast keeps the fixture minimal.
  } as unknown as PresenzeEmployeeData;
}

describe("classification matches legacy xlsx colors (regression)", () => {
  it("isRed/isYellow per day equal the legacy inline rule for the fixture month", async () => {
    const { classifyEmployeeDays } = await import("./excel-presenze");
    const emp = fixtureEmployee();
    const year = 2026, month = 5;
    const nDays = new Date(year, month, 0).getDate();
    const classifications = classifyEmployeeDays(emp, year, month, () => true);

    for (let d = 1; d <= nDays; d++) {
      const dateStr = `${year}-05-${String(d).padStart(2, "0")}`;
      const legacy = legacyColor(emp, d, dateStr);
      const c = classifications.get(d)!;
      const newColor = c.isRed ? "red" : c.isYellow ? "yellow" : null;
      expect(newColor, `day ${d} (${dateStr})`).toBe(legacy);
    }
  });

  it("builder path: colors by PRINTED oreOrdinario, NOT raw stats.hoursWorked", async () => {
    // Guards the byte-identity fix: the builder injects real DailyStats, but the
    // color decision must use the printed cell value. A day printed O=6.5 (< 8)
    // must stay RED even if raw stats report hoursWorked 8.1 (would be "ok").
    const { classifyEmployeeDays } = await import("./excel-presenze");
    const emp = fixtureEmployee();
    emp.scheduledHoursPerDay.set(8, 8);
    emp.days.set(8, { oreOrdinario: 6.5, oreFuoriSede: null });
    const classifications = classifyEmployeeDays(
      emp,
      2026,
      5,
      () => true,
      (d) =>
        d === 8
          ? ({
              employeeId: "e", employeeName: "x", date: "2026-05-08",
              hoursWorked: 8.1, hoursWorkedMsg: 0, pauseMinutes: 0, pauses: [],
              morningDelay: 0, afternoonDelay: 0, overtime: 0, overtimeBlocks: [],
              hasAnomaly: false, anomalies: [], entries: [], exits: [],
            } as unknown as import("@/lib/calculator").DailyStats)
          : null,
    );
    const c = classifications.get(8)!;
    expect(c.effectiveHours).toBe(6.5); // printed, not 8.1
    expect(c.isRed).toBe(true);
    expect(c.isYellow).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/lib/excel-presenze.classify.test.ts`
  Expected: FAIL — `classifyEmployeeDays` is not exported from `excel-presenze`.

- [ ] **Step 3: Implement**

  3a. Add the import and extend the type in `src/lib/excel-presenze.ts`. Replace the existing imports block (lines 16-24) to add `classifyDay` + `DayClassification`, and the `isActiveOn` from Feature 2:

```ts
import ExcelJS from "exceljs";
import { isNonWorkingDay } from "./holidays-it";
import { prisma } from "./db";
import { getDayOfWeek } from "./date-utils";
import {
  calculateDailyStats,
  type DailyRecord,
  type DailyStats,
  type EmployeeScheduleDay,
} from "./calculator";
import { classifyDay, type DayClassification } from "./presenze/classify";
import { isActiveOn } from "./employees/active";
```

  3b. Extend `PresenzeEmployeeData` (after line 38 `scheduledHoursPerDay`):

```ts
export interface PresenzeEmployeeData {
  employeeId: string; // stable Employee.id (for the review day-editor; xlsx ignores it)
  displayName: string; // "COGNOME NOME" (gia' uppercase)
  contractType: string; // "FULL_TIME" | "PART_TIME"
  days: Map<number, PresenzeDayData>; // giorno 1-31 → dati
  straordinari: number; // ore straordinari del mese, arrotondate ai 15 min
  scheduledHoursPerDay: Map<number, number>; // giorno 1-31 → ore pianificate dallo schedule
  /** Canonical classification per day-of-month (1-31). Drives cell color + review UI. */
  classifications: Map<number, DayClassification>;
}
```

> The `employeeId` field is new (the legacy shape had only `displayName`). It is set from the already-selected `emp.id` in the builder (Step 3e) and consumed by the review API (Task 5) so the day editor targets a stable id instead of a fragile display-name join.

  3c. Add an exported `classifyEmployeeDays` helper (place it just above `buildPresenzeMonthData`, after `HALF_DAY_LEAVE_TYPES` at line 369). It rebuilds the classification purely from a finished `PresenzeEmployeeData` so the regression test (and the xlsx loop) share one path. `leaveHours` is reconstructed as `oreFuoriSede` (the F/P column already encodes leave hours), and `workedHours`/`anomalies` come from an injected `statsForDay` lookup (the builder passes the real `DailyStats`; the test passes a stub):

```ts
/**
 * Build the per-day DayClassification map for a finished PresenzeEmployeeData.
 * Pure given (emp, year, month, isActiveOnDay, statsForDay). `effectiveHours`
 * is derived from the same O + F/P values the xlsx prints (totale), so colors
 * stay byte-identical to the legacy inline rule.
 *
 * @param isActiveOnDay (dateStr) => boolean — Feature 2 isActiveOn closure.
 * @param statsForDay   (d) => DailyStats | null — real stats (for anomalies),
 *                      optional; defaults to null (no anomalies, hours from O+F/P).
 */
export function classifyEmployeeDays(
  emp: PresenzeEmployeeData,
  year: number,
  month: number,
  isActiveOnDay: (dateStr: string) => boolean,
  statsForDay?: (d: number) => DailyStats | null,
): Map<number, DayClassification> {
  const monthStr = String(month).padStart(2, "0");
  const nDays = new Date(year, month, 0).getDate();
  const out = new Map<number, DayClassification>();
  for (let d = 1; d <= nDays; d++) {
    const dateStr = `${year}-${monthStr}-${String(d).padStart(2, "0")}`;
    const scheduledHours = emp.scheduledHoursPerDay.get(d) ?? 0;
    const dayData = emp.days.get(d);
    const oreOrdinario = dayData?.oreOrdinario ?? 0;
    const oreFuoriSede = dayData?.oreFuoriSede ?? 0;
    // F/P column carries leave (and fuori-sede) hours; treat it as leaveHours so
    // effectiveHours = totale, matching the printed cell value exactly.
    const leaveHours = oreFuoriSede;
    // BYTE-IDENTITY: the COLOR decision MUST use the PRINTED hours
    // (oreOrdinario + oreFuoriSede = totale), NOT the raw stats.hoursWorked.
    // stats.hoursWorked is un-rounded/un-capped and would drift from the printed
    // cell at roundHalf / hourly-leave-cap boundaries, silently changing report
    // colors. So we always feed classifyDay hoursWorked = oreOrdinario and only
    // BORROW anomalies/entries from the real stats (for the issue panel).
    const realStats = statsForDay ? statsForDay(d) : null;
    const dailyStats: DailyStats | null =
      realStats || oreOrdinario > 0
        ? ({
            employeeId: realStats?.employeeId ?? "",
            employeeName: realStats?.employeeName ?? "",
            date: dateStr,
            hoursWorked: oreOrdinario, // PRINTED value → effectiveHours === totale
            hoursWorkedMsg: 0, pauseMinutes: 0, pauses: [],
            morningDelay: 0, afternoonDelay: 0, overtime: 0, overtimeBlocks: [],
            hasAnomaly: (realStats?.anomalies.length ?? 0) > 0,
            anomalies: realStats?.anomalies ?? [],
            entries: realStats?.entries ?? [],
            exits: realStats?.exits ?? [],
          } as DailyStats)
        : null;
    out.set(
      d,
      classifyDay({
        date: dateStr,
        scheduledHours,
        dailyStats,
        leaveHours,
        isNonWorkingDay: isNonWorkingDay(dateStr),
        isActiveOnDay: isActiveOnDay(dateStr),
      }),
    );
  }
  return out;
}
```

  3d. In `buildPresenzeMonthData`, keep a per-(employee,date) `DailyStats` map so classification can attach real anomalies. Replace the `hoursMap` block (lines 460-467) to also store stats:

```ts
  // Calcola DailyStats per ogni (employee, date) che abbia record
  const hoursMap = new Map<string, number>(); // "employeeId|YYYY-MM-DD" → hoursWorked
  const statsMap = new Map<string, DailyStats>(); // "employeeId|YYYY-MM-DD" → stats
  for (const dr of grouped.values()) {
    const dayOfWeek = getDayOfWeek(dr.date);
    const empSchedule = scheduleMap.get(dr.employeeId)?.get(dayOfWeek) ?? null;
    const stats = calculateDailyStats(dr, empSchedule);
    hoursMap.set(`${dr.employeeId}|${dr.date}`, stats.hoursWorked);
    statsMap.set(`${dr.employeeId}|${dr.date}`, stats);
  }
```

  3e. After the per-employee `days`/`scheduledHoursPerDay` loop finishes building, compute `classifications` before `presenzeEmployees.push`. Replace the push block (lines 535-541):

```ts
    const classifications = classifyEmployeeDays(
      {
        employeeId: emp.id,
        displayName: (emp.displayName || emp.name).toUpperCase(),
        contractType: emp.contractType,
        days,
        straordinari: roundQuarter(overtimeTotal),
        scheduledHoursPerDay,
        classifications: new Map(),
      },
      year,
      month,
      (dateStr) => isActiveOn(emp, dateStr),
      (d) => {
        const dateStr = `${yearStr}-${monthStr}-${String(d).padStart(2, "0")}`;
        return statsMap.get(`${emp.id}|${dateStr}`) ?? null;
      },
    );

    presenzeEmployees.push({
      employeeId: emp.id,
      displayName: (emp.displayName || emp.name).toUpperCase(),
      contractType: emp.contractType,
      days,
      straordinari: roundQuarter(overtimeTotal),
      scheduledHoursPerDay,
      classifications,
    });
```

  3f. Refactor the `generatePresenzeXlsx` cell loop (lines 309-323) to read the classification instead of inlining the comparison. Replace the block from `// Colore cella:` through the closing brace of the `if (scheduledHoursDay > 0)`:

```ts
        // Colore cella: deriva da DayClassification (single source of truth,
        // stessa logica del report e della pagina di revisione).
        const cls = emp.classifications.get(d);
        if (cls?.isRed) {
          const redFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
          cellO.fill = redFill;
          cellFP.fill = redFill;
        } else if (cls?.isYellow) {
          const yellowFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
          cellO.fill = yellowFill;
          cellFP.fill = yellowFill;
        }
```

> Note: the legacy rule never colored a `non_working` day and only colored when `scheduledHoursDay > 0`; `classifyDay` returns `isRed=isYellow=false` for `non_working`, so the gate is preserved. The legacy "absent" day (totale 0 < scheduled) was RED — `classifyDay` returns `status: "absent", isRed: true`, identical. This is the byte-identity the regression test guards.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `npx vitest run src/lib/excel-presenze.classify.test.ts src/lib/presenze/classify.test.ts`
  Expected: PASS. Then full suite to ensure no regression: `npm test`. Expected: PASS.

- [ ] **Step 5: Manual verification (byte-identical sheet)**
  Run: `npm run build`
  Expected: build succeeds (the `isActiveOn` import resolves against Feature 2's `src/lib/employees/active.ts`). The emailed xlsx is unchanged because the only behavioral change is reading `isRed`/`isYellow` from `classifyDay`, which the regression test proves equals the prior inline rule.

- [ ] **Step 6: Commit**

```bash
git add src/lib/excel-presenze.ts src/lib/excel-presenze.classify.test.ts && git commit -m "refactor(presenze): route xlsx colors through classifyDay, expose classifications (revisione task 2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `AttendanceRecordEdit` model + shared recompute helper + `computeRecordDiff`

**Files:**
- Modify: `prisma/schema.prisma` (add model after `LeaveRequestEdit` ~303; add `User.recordEdits` relation after line 23)
- Create: `src/lib/attendance/recompute.ts` (extract `resyncAnomaliesForDates` from `src/app/api/records/[id]/route.ts:112-173` → exported `recomputeAnomaliesForDates`; add pure `computeRecordDiff` mirroring `src/lib/leaves/audit.ts:52`)
- Test: `src/lib/attendance/recompute.test.ts`
- Modify: `src/app/api/records/[id]/route.ts` (PUT + DELETE use the shared helper; both audit)
- Modify: `src/app/api/records/route.ts` (POST recomputes + audits)

- [ ] **Step 1: Add the Prisma model + relation**

  Add to `model User` (after line 23 `leaveEdits ...`):

```prisma
  recordEdits    AttendanceRecordEdit[] @relation("UserRecordEdits")
```

  Add after `model LeaveRequestEdit { ... }` (end of file):

```prisma
model AttendanceRecordEdit {
  id          String   @id @default(cuid())
  recordId    String?           // null if the record was deleted
  employeeId  String
  date        String            // YYYY-MM-DD, for range queries
  editedById  String
  editedAt    DateTime @default(now())
  action      String            // CREATE | UPDATE | DELETE

  // Snapshot pre-edit (only watched fields)
  oldType         String?
  oldDeclaredTime String?
  oldDate         String?

  // Snapshot post-edit
  newType         String?
  newDeclaredTime String?
  newDate         String?

  reason        String?         // optional free text from the review UI
  source        String          // "REVIEW" | "RECORDS" | "ANOMALY_RESOLUTION"
  changedFields String          @default("[]") // JSON array, denormalized

  editedBy User @relation("UserRecordEdits", fields: [editedById], references: [id])

  @@index([employeeId, date])
  @@index([recordId])
  @@index([editedById])
}
```

- [ ] **Step 2: Push schema + regenerate client**
  Run: `npm run db:push && npm run db:generate`
  Expected: db:push reports the `AttendanceRecordEdit` table created (no data loss prompt for existing tables); db:generate regenerates the Prisma client so `prisma.attendanceRecordEdit` is typed.

- [ ] **Step 3: Write the failing test for `computeRecordDiff`**

```ts
// src/lib/attendance/recompute.test.ts
import { describe, it, expect } from "vitest";
import { computeRecordDiff, WATCHED_RECORD_FIELDS } from "./recompute";

const base = { type: "ENTRY", declaredTime: "09:00", date: "2026-05-04" };

describe("WATCHED_RECORD_FIELDS", () => {
  it("watches exactly type, declaredTime, date", () => {
    expect([...WATCHED_RECORD_FIELDS].sort()).toEqual(["date", "declaredTime", "type"]);
  });
});

describe("computeRecordDiff", () => {
  it("empty changedFields when nothing changed", () => {
    expect(computeRecordDiff(base, { ...base }).changedFields).toEqual([]);
  });

  it("captures declaredTime change", () => {
    const d = computeRecordDiff(base, { ...base, declaredTime: "09:15" });
    expect(d.changedFields).toEqual(["declaredTime"]);
    expect(d.changes.declaredTime).toEqual({ old: "09:00", new: "09:15" });
  });

  it("captures type change", () => {
    const d = computeRecordDiff(base, { ...base, type: "EXIT" });
    expect(d.changedFields).toEqual(["type"]);
  });

  it("captures multiple changes (type + date)", () => {
    const d = computeRecordDiff(base, { ...base, type: "EXIT", date: "2026-05-05" });
    expect(d.changedFields.sort()).toEqual(["date", "type"]);
  });

  it("treats null and undefined as equal (no spurious change)", () => {
    const d = computeRecordDiff(
      { type: "ENTRY", declaredTime: "09:00", date: null },
      { type: "ENTRY", declaredTime: "09:00", date: undefined },
    );
    expect(d.changedFields).toEqual([]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**
  Run: `npx vitest run src/lib/attendance/recompute.test.ts`
  Expected: FAIL — `recompute.ts` does not exist.

- [ ] **Step 5: Implement `recompute.ts`** (extract the existing resync logic verbatim into an exported function + add the pure diff)

```ts
// src/lib/attendance/recompute.ts
import { prisma } from "@/lib/db";
import {
  calculateDailyStats,
  type DailyRecord,
  type EmployeeScheduleDay,
} from "@/lib/calculator";
import { syncAnomalies } from "@/lib/anomaly-sync";

export const WATCHED_RECORD_FIELDS = ["type", "declaredTime", "date"] as const;
export type WatchedRecordField = (typeof WATCHED_RECORD_FIELDS)[number];

export interface RecordSnapshot {
  type?: string | null;
  declaredTime?: string | null;
  date?: string | null;
  [key: string]: unknown;
}

export interface RecordDiff {
  changedFields: WatchedRecordField[];
  changes: Partial<Record<WatchedRecordField, { old: unknown; new: unknown }>>;
}

function eq(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  return a === b;
}

/** Pure diff over the editable record fields. Mirrors leaves/audit computeDiff. */
export function computeRecordDiff(prev: RecordSnapshot, next: RecordSnapshot): RecordDiff {
  const changedFields: WatchedRecordField[] = [];
  const changes: RecordDiff["changes"] = {};
  for (const f of WATCHED_RECORD_FIELDS) {
    if (!eq(prev[f], next[f])) {
      changedFields.push(f);
      changes[f] = { old: prev[f] ?? null, new: next[f] ?? null };
    }
  }
  return { changedFields, changes };
}

/**
 * Recalculates anomalies for the given employee on the given dates and resolves
 * stale unresolved anomalies. Extracted from records/[id]/route.ts so POST,
 * PUT, DELETE and the batch day endpoint all share one recompute path.
 */
export async function recomputeAnomaliesForDates(
  employeeId: string,
  employeeName: string,
  dates: string[],
): Promise<void> {
  const sorted = [...dates].sort();
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];

  const attendanceRecords = await prisma.attendanceRecord.findMany({
    where: { employeeId, date: { gte: minDate, lte: maxDate } },
    include: { employee: true },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });

  const schedules = await prisma.employeeSchedule.findMany({ where: { employeeId } });
  const empScheduleMap = new Map<number, EmployeeScheduleDay>();
  for (const s of schedules) {
    empScheduleMap.set(s.dayOfWeek, {
      block1Start: s.block1Start,
      block1End: s.block1End,
      block2Start: s.block2Start,
      block2End: s.block2End,
    });
  }

  const grouped = new Map<string, DailyRecord>();
  for (const r of attendanceRecords) {
    if (!grouped.has(r.date)) {
      grouped.set(r.date, {
        employeeId: r.employeeId,
        employeeName: r.employee.displayName || r.employee.name,
        date: r.date,
        records: [],
      });
    }
    grouped.get(r.date)!.records.push({
      type: r.type as DailyRecord["records"][0]["type"],
      declaredTime: r.declaredTime,
      messageTime: r.messageTime,
    });
  }

  // Ensure every requested date is represented (even if it now has 0 records)
  for (const date of dates) {
    if (!grouped.has(date)) {
      grouped.set(date, { employeeId, employeeName, date, records: [] });
    }
  }

  const dailyStats = Array.from(grouped.values()).map((dr) => {
    const [y, m, d] = dr.date.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const dayOfWeek = dow === 0 ? 7 : dow;
    const schedule = empScheduleMap.get(dayOfWeek) ?? null;
    return calculateDailyStats(dr, schedule);
  });

  await syncAnomalies(dailyStats, {
    resolveNote: "Risolta automaticamente da modifica timbratura",
  });
}
```

- [ ] **Step 6: Run test to verify it passes**
  Run: `npx vitest run src/lib/attendance/recompute.test.ts`
  Expected: PASS.

- [ ] **Step 7: Repoint `records/[id]/route.ts` to the shared helper + audit**
  Replace the import of the local helper usage and delete the now-duplicated `resyncAnomaliesForDates` (lines 108-173). Replace top imports (lines 1-6):

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { notificationsBus } from "@/lib/notifications-bus";
import { auth } from "@/lib/auth";
import { recomputeAnomaliesForDates, computeRecordDiff } from "@/lib/attendance/recompute";
```

  In `PUT`, after the `prisma.attendanceRecord.update` (line 73-77) and before the bus publish, add the audit write; and replace the `resyncAnomaliesForDates(...)` call (lines 96-100) with `recomputeAnomaliesForDates(...)`. Insert after line 77:

```ts
  const session = await auth();
  const editorId = session?.user?.id ?? null;
  if (editorId) {
    const diff = computeRecordDiff(
      { type: original.type, declaredTime: original.declaredTime, date: original.date },
      { type: record.type, declaredTime: record.declaredTime, date: record.date },
    );
    if (diff.changedFields.length > 0) {
      await prisma.attendanceRecordEdit.create({
        data: {
          recordId: record.id,
          employeeId: record.employeeId,
          date: record.date,
          editedById: editorId,
          action: "UPDATE",
          oldType: original.type, oldDeclaredTime: original.declaredTime, oldDate: original.date,
          newType: record.type, newDeclaredTime: record.declaredTime, newDate: record.date,
          source: "RECORDS",
          changedFields: JSON.stringify(diff.changedFields),
        },
      });
    }
  }
```

  Replace the resync call (lines 95-103):

```ts
  try {
    await recomputeAnomaliesForDates(
      original.employeeId,
      original.employee.displayName || original.employee.name,
      datesToSync,
    );
  } catch (err) {
    console.error("[records/PUT] anomaly sync failed:", err);
  }
```

  Delete the entire local `async function resyncAnomaliesForDates(...)` (old lines 108-173).

  In `DELETE`, after `prisma.attendanceRecord.delete` (line 189), add audit + recompute (the existing code only published a bus event). Insert inside `if (existing) { ... }` after the bus publish try/catch:

```ts
    const session = await auth();
    const editorId = session?.user?.id ?? null;
    if (editorId) {
      try {
        await prisma.attendanceRecordEdit.create({
          data: {
            recordId: null,
            employeeId: existing.employeeId,
            date: existing.date,
            editedById: editorId,
            action: "DELETE",
            oldType: existing.type, oldDeclaredTime: existing.declaredTime, oldDate: existing.date,
            source: "RECORDS",
            changedFields: JSON.stringify(["type", "declaredTime", "date"]),
          },
        });
      } catch (err) {
        console.error("[records/DELETE] audit write failed:", err);
      }
    }
    try {
      await recomputeAnomaliesForDates(
        existing.employeeId,
        existing.employee.displayName || existing.employee.name,
        [existing.date],
      );
    } catch (err) {
      console.error("[records/DELETE] anomaly sync failed:", err);
    }
```

- [ ] **Step 8: Add recompute + audit to `records/route.ts` POST**
  Add imports at top (after line 4):

```ts
import { auth } from "@/lib/auth";
import { recomputeAnomaliesForDates } from "@/lib/attendance/recompute";
```

  After the bus publish try/catch in POST (after line 143) and before `return NextResponse.json(record, ...)`:

```ts
  const session = await auth();
  const editorId = session?.user?.id ?? null;
  if (editorId) {
    try {
      await prisma.attendanceRecordEdit.create({
        data: {
          recordId: record.id,
          employeeId,
          date,
          editedById: editorId,
          action: "CREATE",
          newType: type, newDeclaredTime: declaredTime, newDate: date,
          source: "RECORDS",
          changedFields: JSON.stringify(["type", "declaredTime", "date"]),
        },
      });
    } catch (err) {
      console.error("[records/POST] audit write failed:", err);
    }
  }
  try {
    await recomputeAnomaliesForDates(employeeId, employee.displayName || employee.name, [date]);
  } catch (err) {
    console.error("[records/POST] anomaly sync failed:", err);
  }
```

- [ ] **Step 9: Verify build + full suite**
  Run: `npm run build && npm test`
  Expected: build succeeds, all tests pass. (No automated route test — these routes hit Prisma; the pure `computeRecordDiff` is covered, and the recompute extraction is byte-identical to the prior verified PUT logic.)

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma src/lib/attendance/recompute.ts src/lib/attendance/recompute.test.ts src/app/api/records/route.ts "src/app/api/records/[id]/route.ts" && git commit -m "feat(attendance): AttendanceRecordEdit audit + shared recompute helper; close POST/DELETE recompute gap (revisione task 3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Batch day endpoint `PUT /api/presenze/review/day` + repoint `/employees/[id]` editor

**Files:**
- Create: `src/lib/attendance/review-day.ts` (pure `planDayBatch`)
- Test: `src/lib/attendance/review-day.test.ts`
- Create: `src/app/api/presenze/review/day/route.ts` (thin transactional wrapper)
- Modify: `src/app/(dashboard)/employees/[id]/page.tsx` (replace N-parallel-PUT save loop + add POST + per-row DELETE with one batch call)

Body: `{ employeeId, date, records: [{ id?, type, declaredTime }], reason? }`.

- [ ] **Step 1: Write the failing test for `planDayBatch`**

```ts
// src/lib/attendance/review-day.test.ts
import { describe, it, expect } from "vitest";
import { planDayBatch, type ExistingRecord, type SubmittedRecord } from "./review-day";

const existing: ExistingRecord[] = [
  { id: "r1", type: "ENTRY", declaredTime: "09:00" },
  { id: "r2", type: "EXIT", declaredTime: "13:00" },
  { id: "r3", type: "ENTRY", declaredTime: "14:00" },
];

describe("planDayBatch", () => {
  it("creates records with no id", () => {
    const submitted: SubmittedRecord[] = [{ type: "EXIT", declaredTime: "18:00" }];
    const plan = planDayBatch(existing, submitted);
    expect(plan.toCreate).toEqual([{ type: "EXIT", declaredTime: "18:00" }]);
  });

  it("updates a record whose declaredTime changed", () => {
    const submitted: SubmittedRecord[] = [
      { id: "r1", type: "ENTRY", declaredTime: "09:15" },
      { id: "r2", type: "EXIT", declaredTime: "13:00" },
      { id: "r3", type: "ENTRY", declaredTime: "14:00" },
    ];
    const plan = planDayBatch(existing, submitted);
    expect(plan.toUpdate).toEqual([{ id: "r1", type: "ENTRY", declaredTime: "09:15" }]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.toCreate).toEqual([]);
  });

  it("deletes records omitted from the submission", () => {
    const submitted: SubmittedRecord[] = [{ id: "r1", type: "ENTRY", declaredTime: "09:00" }];
    const plan = planDayBatch(existing, submitted);
    expect(plan.toDelete.sort()).toEqual(["r2", "r3"]);
  });

  it("no-ops an unchanged record (not in update)", () => {
    const submitted: SubmittedRecord[] = [
      { id: "r1", type: "ENTRY", declaredTime: "09:00" },
      { id: "r2", type: "EXIT", declaredTime: "13:00" },
      { id: "r3", type: "ENTRY", declaredTime: "14:00" },
    ];
    const plan = planDayBatch(existing, submitted);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });

  it("detects an intra-batch collision (two records same type+time)", () => {
    const submitted: SubmittedRecord[] = [
      { id: "r1", type: "ENTRY", declaredTime: "09:00" },
      { type: "ENTRY", declaredTime: "09:00" }, // duplicate of r1's identity
    ];
    const plan = planDayBatch(existing, submitted);
    expect(plan.collision).toBe(true);
  });

  it("no collision when final set has unique (type, declaredTime)", () => {
    const submitted: SubmittedRecord[] = [
      { id: "r1", type: "ENTRY", declaredTime: "09:00" },
      { type: "ENTRY", declaredTime: "09:30" },
    ];
    const plan = planDayBatch(existing, submitted);
    expect(plan.collision).toBe(false);
  });

  it("rejects a submitted id not present in existing (stale)", () => {
    const submitted: SubmittedRecord[] = [{ id: "ghost", type: "ENTRY", declaredTime: "09:00" }];
    const plan = planDayBatch(existing, submitted);
    expect(plan.unknownIds).toEqual(["ghost"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/lib/attendance/review-day.test.ts`
  Expected: FAIL — `review-day.ts` does not exist.

- [ ] **Step 3: Implement `review-day.ts`**

```ts
// src/lib/attendance/review-day.ts

export interface ExistingRecord {
  id: string;
  type: string;
  declaredTime: string;
}

export interface SubmittedRecord {
  id?: string;
  type: string;
  declaredTime: string;
}

export interface DayBatchPlan {
  toCreate: { type: string; declaredTime: string }[];
  toUpdate: { id: string; type: string; declaredTime: string }[];
  toDelete: string[];
  /** Final (type, declaredTime) set has a duplicate -> would violate @@unique. */
  collision: boolean;
  /** Submitted ids not found among existing records (stale client state). */
  unknownIds: string[];
}

/**
 * Pure diff of a submitted day record set against the existing records for
 * (employeeId, date). The route turns this into a $transaction.
 */
export function planDayBatch(
  existing: ExistingRecord[],
  submitted: SubmittedRecord[],
): DayBatchPlan {
  const existingById = new Map(existing.map((r) => [r.id, r]));
  const submittedIds = new Set<string>();
  const unknownIds: string[] = [];

  const toCreate: DayBatchPlan["toCreate"] = [];
  const toUpdate: DayBatchPlan["toUpdate"] = [];

  for (const s of submitted) {
    if (s.id) {
      submittedIds.add(s.id);
      const cur = existingById.get(s.id);
      if (!cur) {
        unknownIds.push(s.id);
        continue;
      }
      if (cur.type !== s.type || cur.declaredTime !== s.declaredTime) {
        toUpdate.push({ id: s.id, type: s.type, declaredTime: s.declaredTime });
      }
    } else {
      toCreate.push({ type: s.type, declaredTime: s.declaredTime });
    }
  }

  const toDelete = existing
    .filter((r) => !submittedIds.has(r.id))
    .map((r) => r.id);

  // Collision: the FINAL set (everything submitted, both kept & changed & created)
  // must have unique (type, declaredTime).
  const finalKeys = submitted.map((s) => `${s.type}|${s.declaredTime}`);
  const collision = new Set(finalKeys).size !== finalKeys.length;

  return { toCreate, toUpdate, toDelete, collision, unknownIds };
}
```

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/lib/attendance/review-day.test.ts`
  Expected: PASS.

- [ ] **Step 5: Implement the thin route `PUT /api/presenze/review/day`**

```ts
// src/app/api/presenze/review/day/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { notificationsBus } from "@/lib/notifications-bus";
import { recomputeAnomaliesForDates } from "@/lib/attendance/recompute";
import { planDayBatch, type SubmittedRecord } from "@/lib/attendance/review-day";

const VALID_TYPES = ["ENTRY", "EXIT", "PAUSE_START", "PAUSE_END", "OVERTIME_START", "OVERTIME_END"];

export async function PUT(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const session = await auth();
  const editorId = session?.user?.id ?? null;

  const body = await request.json();
  const { employeeId, date, records, reason } = body as {
    employeeId: string;
    date: string;
    records: SubmittedRecord[];
    reason?: string;
  };

  if (!employeeId || !date || !Array.isArray(records)) {
    return NextResponse.json({ error: "Campi obbligatori: employeeId, date, records[]" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }
  for (const r of records) {
    if (!VALID_TYPES.includes(r.type)) {
      return NextResponse.json({ error: `Tipo non valido: ${r.type}` }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(r.declaredTime)) {
      return NextResponse.json({ error: `Orario non valido: ${r.declaredTime}` }, { status: 400 });
    }
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  const existingRows = await prisma.attendanceRecord.findMany({
    where: { employeeId, date },
    orderBy: [{ declaredTime: "asc" }],
  });
  const plan = planDayBatch(
    existingRows.map((r) => ({ id: r.id, type: r.type, declaredTime: r.declaredTime })),
    records,
  );

  if (plan.unknownIds.length > 0) {
    return NextResponse.json(
      { error: `Record non trovati (stato non aggiornato): ${plan.unknownIds.join(", ")}` },
      { status: 409 },
    );
  }
  if (plan.collision) {
    return NextResponse.json(
      { error: "Due registrazioni hanno lo stesso tipo e orario nello stesso giorno" },
      { status: 409 },
    );
  }

  const existingById = new Map(existingRows.map((r) => [r.id, r]));

  try {
    await prisma.$transaction(async (tx) => {
      for (const id of plan.toDelete) {
        const cur = existingById.get(id)!;
        await tx.attendanceRecord.delete({ where: { id } });
        if (editorId) {
          await tx.attendanceRecordEdit.create({
            data: {
              recordId: null, employeeId, date, editedById: editorId, action: "DELETE",
              oldType: cur.type, oldDeclaredTime: cur.declaredTime, oldDate: date,
              reason: reason ?? null, source: "REVIEW",
              changedFields: JSON.stringify(["type", "declaredTime", "date"]),
            },
          });
        }
      }
      for (const u of plan.toUpdate) {
        const cur = existingById.get(u.id)!;
        await tx.attendanceRecord.update({
          where: { id: u.id },
          data: { type: u.type, declaredTime: u.declaredTime },
        });
        if (editorId) {
          await tx.attendanceRecordEdit.create({
            data: {
              recordId: u.id, employeeId, date, editedById: editorId, action: "UPDATE",
              oldType: cur.type, oldDeclaredTime: cur.declaredTime, oldDate: date,
              newType: u.type, newDeclaredTime: u.declaredTime, newDate: date,
              reason: reason ?? null, source: "REVIEW",
              changedFields: JSON.stringify(
                [cur.type !== u.type ? "type" : null, cur.declaredTime !== u.declaredTime ? "declaredTime" : null].filter(Boolean),
              ),
            },
          });
        }
      }
      for (const c of plan.toCreate) {
        const created = await tx.attendanceRecord.create({
          data: {
            employeeId, date, type: c.type, declaredTime: c.declaredTime,
            messageTime: c.declaredTime,
            rawMessage: `[Revisione presenze] ${c.type} ${c.declaredTime}`,
            source: "MANUAL", isManual: true,
          },
        });
        if (editorId) {
          await tx.attendanceRecordEdit.create({
            data: {
              recordId: created.id, employeeId, date, editedById: editorId, action: "CREATE",
              newType: c.type, newDeclaredTime: c.declaredTime, newDate: date,
              reason: reason ?? null, source: "REVIEW",
              changedFields: JSON.stringify(["type", "declaredTime", "date"]),
            },
          });
        }
      }
    });
  } catch (err) {
    // Unique-constraint races inside the tx land here.
    const msg = String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Conflitto: esiste già una registrazione con lo stesso tipo e orario" },
        { status: 409 },
      );
    }
    console.error("[review/day] transaction failed:", err);
    return NextResponse.json({ error: "Salvataggio non riuscito" }, { status: 500 });
  }

  // ONE recompute for the day (closes POST/DELETE gap; batch never N-fires).
  try {
    await recomputeAnomaliesForDates(employeeId, employee.displayName || employee.name, [date]);
  } catch (err) {
    console.error("[review/day] anomaly sync failed:", err);
  }

  try {
    notificationsBus.publish({
      employeeId,
      employeeName: employee.displayName || employee.name,
      action: "RECORD_UPDATED",
      time: "",
      date,
      details: { recordType: "BATCH" },
    });
  } catch (err) {
    console.error("[review/day] bus publish failed:", err);
  }

  return NextResponse.json({ ok: true, created: plan.toCreate.length, updated: plan.toUpdate.length, deleted: plan.toDelete.length });
}
```

- [ ] **Step 6: Repoint the `/employees/[id]` day editor to one batch call**
  In `src/app/(dashboard)/employees/[id]/page.tsx`, the "Salva modifiche" button currently fires N parallel PUTs (lines 598-618). Replace the `onClick` body with a single batch call. Note the local row model has no `id` for newly-added rows after this change, so the "Aggiungi" handler must switch to appending an id-less local row instead of POSTing immediately.

  6a. Replace the "Salva modifiche" `onClick` (the `async () => { setSavingRecords(true); ... }` block at lines 598-618):

```tsx
                          onClick={async () => {
                            setSavingRecords(true);
                            try {
                              const res = await fetch("/api/presenze/review/day", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  employeeId: selectedDay.employeeId,
                                  date: selectedDay.date,
                                  records: editingRecords.map((rec) => ({
                                    ...(rec.id.startsWith("new-") ? {} : { id: rec.id }),
                                    type: rec.type,
                                    declaredTime: rec.declaredTime,
                                  })),
                                }),
                              });
                              if (!res.ok) {
                                const e = await res.json().catch(() => ({}));
                                toast.error(e.error || "Errore nel salvataggio");
                                return;
                              }
                              toast.success("Modifiche salvate");
                              setEditingRecords(null);
                              load();
                            } catch {
                              toast.error("Errore nel salvataggio");
                            } finally {
                              setSavingRecords(false);
                            }
                          }}
```

  6b. Replace the "Aggiungi" `onClick` (lines 630-648) so it appends a local row instead of POSTing (the batch endpoint now creates it):

```tsx
                          onClick={() => {
                            setEditingRecords([
                              ...editingRecords,
                              { id: `new-${Date.now()}`, type: "ENTRY", declaredTime: "09:00" },
                            ]);
                          }}
```

  6c. Replace the per-row DELETE `onClick` (lines 572-587) so it only removes the row locally — the batch save deletes omitted records:

```tsx
                              onClick={async () => {
                                const ok = await confirm({
                                  title: "Elimina registrazione",
                                  message: "Eliminare questa registrazione? Verrà rimossa al salvataggio.",
                                  confirmLabel: "Elimina",
                                  danger: true,
                                });
                                if (!ok) return;
                                setEditingRecords(editingRecords.filter((_, j) => j !== i));
                              }}
```

- [ ] **Step 7: Verify build + suite**
  Run: `npm run build && npm test`
  Expected: build succeeds; all tests pass.

- [ ] **Step 8: Manual verification (endpoint + UI)**
  Run: `npm run dev`, log in as admin, open `/employees/<id>`, select a day, click "Modifica orari".
  - Change a time, add a row, delete a row, click "Salva modifiche" → one network call to `PUT /api/presenze/review/day`, toast "Modifiche salvate", calendar reloads with the corrected day.
  - Add two rows with identical type+time, save → 409 toast "Due registrazioni hanno lo stesso tipo e orario...".
  - curl smoke (replace cookie/ids):
    `curl -X PUT http://localhost:3000/api/presenze/review/day -H "Content-Type: application/json" -b "<session-cookie>" -d '{"employeeId":"<id>","date":"2026-05-04","records":[{"type":"ENTRY","declaredTime":"09:00"},{"type":"EXIT","declaredTime":"18:00"}]}'`
    → `{"ok":true,"created":2,"updated":0,"deleted":...}`; verify an `AttendanceRecordEdit` row per change and that anomalies for the day recomputed once.

- [ ] **Step 9: Commit**

```bash
git add src/lib/attendance/review-day.ts src/lib/attendance/review-day.test.ts src/app/api/presenze/review/day/route.ts "src/app/(dashboard)/employees/[id]/page.tsx" && git commit -m "feat(presenze): transactional batch day endpoint + repoint employee editor off N-parallel-PUT (revisione task 4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Review API `GET /api/presenze/review?month=YYYY-MM`

**Files:**
- Create: `src/lib/presenze/issues.ts` (pure `flattenIssues` + `Issue` type)
- Test: `src/lib/presenze/issues.test.ts`
- Create: `src/app/api/presenze/review/route.ts` (thin wrapper)

The route builds month data via the refactored `buildPresenzeMonthData`, maps each employee's `classifications` to a `DayClassification[]`, computes `overtimeTotal` from `straordinari`, reads report settings, and calls `flattenIssues`. The flattening is the only non-trivial logic and is unit-tested.

- [ ] **Step 1: Write the failing test for `flattenIssues`**

```ts
// src/lib/presenze/issues.test.ts
import { describe, it, expect } from "vitest";
import { flattenIssues, type ReviewEmployee } from "./issues";
import type { DayClassification } from "@/lib/presenze/classify";

function day(partial: Partial<DayClassification>): DayClassification {
  return {
    date: "2026-05-04", status: "ok", scheduledHours: 8, workedHours: 8,
    leaveHours: 0, effectiveHours: 8, anomalies: [], isRed: false, isYellow: false,
    ...partial,
  };
}

const employees: ReviewEmployee[] = [
  {
    employeeId: "e1", name: "Rossi Mario", displayName: "ROSSI MARIO", overtimeTotal: 0,
    days: [
      day({ date: "2026-05-04", status: "under", isRed: true, workedHours: 6, effectiveHours: 6 }),
      day({ date: "2026-05-05", status: "ok" }), // not an issue
      day({ date: "2026-05-06", status: "absent", isRed: true, workedHours: 0, effectiveHours: 0 }),
      day({
        date: "2026-05-07", status: "over", isYellow: true, workedHours: 9, effectiveHours: 9,
        anomalies: [{ type: "TIME_OVERLAP", description: "Uscita 1 prima di Entrata 1", severity: "possible" }],
      }),
      day({
        date: "2026-05-08", status: "ok", isRed: true,
        anomalies: [{ type: "MISSING_EXIT", description: "Entrata senza uscita", severity: "structural" }],
      }),
    ],
  },
];

describe("flattenIssues", () => {
  it("emits one issue per red/yellow day, skips ok days", () => {
    const issues = flattenIssues(employees);
    expect(issues.map((i) => i.date)).toEqual([
      "2026-05-04", "2026-05-06", "2026-05-07", "2026-05-08",
    ]);
  });

  it("tags severity red for under/absent/structural and yellow for over/possible", () => {
    const issues = flattenIssues(employees);
    const byDate = Object.fromEntries(issues.map((i) => [i.date, i.severity]));
    expect(byDate["2026-05-04"]).toBe("red");
    expect(byDate["2026-05-06"]).toBe("red");
    expect(byDate["2026-05-07"]).toBe("yellow");
    expect(byDate["2026-05-08"]).toBe("red");
  });

  it("under day reason mentions ore sotto soglia", () => {
    const i = flattenIssues(employees).find((x) => x.date === "2026-05-04")!;
    expect(i.reasons.join(" ")).toMatch(/sotto soglia/i);
  });

  it("absent day reason mentions assenza", () => {
    const i = flattenIssues(employees).find((x) => x.date === "2026-05-06")!;
    expect(i.reasons.join(" ")).toMatch(/assenza/i);
  });

  it("includes anomaly descriptions in reasons", () => {
    const i = flattenIssues(employees).find((x) => x.date === "2026-05-08")!;
    expect(i.reasons.join(" ")).toMatch(/Entrata senza uscita/);
  });

  it("carries employeeId and employeeName on each issue", () => {
    const i = flattenIssues(employees)[0];
    expect(i.employeeId).toBe("e1");
    expect(i.employeeName).toBe("ROSSI MARIO");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/lib/presenze/issues.test.ts`
  Expected: FAIL — `issues.ts` does not exist.

- [ ] **Step 3: Implement `issues.ts`**

```ts
// src/lib/presenze/issues.ts
import type { DayClassification, DayStatus } from "@/lib/presenze/classify";

export interface ReviewEmployee {
  employeeId: string;
  name: string;
  displayName: string;
  days: DayClassification[];
  overtimeTotal: number;
}

export interface Issue {
  employeeId: string;
  employeeName: string;
  date: string;
  status: DayStatus;
  severity: "red" | "yellow";
  reasons: string[]; // human descriptions
  recordIds: string[]; // editable records on that day (empty for absence)
}

/**
 * Flatten the per-employee classifications into a sortable worklist of
 * red/yellow days. Pure. `recordIds` is left empty here (the route does not
 * carry them in the classification); the day editor fetches records on open.
 */
export function flattenIssues(employees: ReviewEmployee[]): Issue[] {
  const issues: Issue[] = [];
  for (const emp of employees) {
    for (const d of emp.days) {
      if (!d.isRed && !d.isYellow) continue;
      const reasons: string[] = [];
      if (d.status === "absent") reasons.push("Assenza non giustificata");
      else if (d.status === "under") reasons.push(`Ore sotto soglia (${d.effectiveHours}h / ${d.scheduledHours}h)`);
      else if (d.status === "over") reasons.push(`Ore sopra soglia (${d.effectiveHours}h / ${d.scheduledHours}h)`);
      for (const a of d.anomalies) reasons.push(a.description);
      issues.push({
        employeeId: emp.employeeId,
        employeeName: emp.displayName,
        date: d.date,
        status: d.status,
        severity: d.isRed ? "red" : "yellow",
        reasons,
        recordIds: [],
      });
    }
  }
  return issues;
}
```

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/lib/presenze/issues.test.ts`
  Expected: PASS.

- [ ] **Step 5: Implement the thin route `GET /api/presenze/review`**

```ts
// src/app/api/presenze/review/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { buildPresenzeMonthData } from "@/lib/excel-presenze";
import { flattenIssues, type ReviewEmployee } from "@/lib/presenze/issues";

function prevMonth(now: Date): { year: number; month: number } {
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return { year, month };
}

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month");
  let year: number, month: number;
  if (monthParam) {
    if (!/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: "Formato month non valido (YYYY-MM)" }, { status: 400 });
    }
    [year, month] = monthParam.split("-").map(Number);
  } else {
    ({ year, month } = prevMonth(new Date()));
  }
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  const [data, daySetting, enabledSetting, lastSentSetting] = await Promise.all([
    buildPresenzeMonthData(year, month),
    prisma.appSetting.findUnique({ where: { key: "monthlyReportDay" } }),
    prisma.appSetting.findUnique({ where: { key: "monthlyReportEnabled" } }),
    prisma.appSetting.findUnique({ where: { key: "lastReportSent" } }),
  ]);

  // buildPresenzeMonthData now exposes the stable Employee.id on each row
  // (PresenzeEmployeeData.employeeId, added in Task 2) — used directly by the
  // day editor. No fragile display-name join.
  const nDays = new Date(year, month, 0).getDate();
  const employees: ReviewEmployee[] = data.employees.map((emp) => {
    const days = [];
    for (let d = 1; d <= nDays; d++) {
      const c = emp.classifications.get(d);
      if (c) days.push(c);
    }
    return {
      employeeId: emp.employeeId,
      name: emp.displayName,
      displayName: emp.displayName,
      days,
      overtimeTotal: emp.straordinari,
    };
  });

  const issues = flattenIssues(employees);

  return NextResponse.json({
    month: monthStr,
    reportDay: daySetting ? parseInt(daySetting.value, 10) : 5,
    reportEnabled: enabledSetting ? enabledSetting.value !== "false" : true,
    alreadySent: lastSentSetting?.value === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}` && monthStr === prevMonthStr(new Date()),
    employees,
    issues,
  });
}

function prevMonthStr(now: Date): string {
  const { year, month } = prevMonth(now);
  return `${year}-${String(month).padStart(2, "0")}`;
}
```

> `alreadySent` is true only when the requested month equals the report's previous-month target AND `lastReportSent` equals the current YYYY-MM (matching the worker's `lastReportSent` semantics in `monthly-report-worker.ts:96-98`).

- [ ] **Step 6: Verify build + suite**
  Run: `npm run build && npm test`
  Expected: build succeeds; tests pass.

- [ ] **Step 7: Manual verification**
  Run: `npm run dev`; as admin: `curl http://localhost:3000/api/presenze/review?month=2026-05 -b "<session-cookie>"`.
  Expected JSON with `month`, `reportDay`, `reportEnabled`, `alreadySent`, `employees[].days[]` (one classification per day-of-month), `employees[].overtimeTotal`, and `issues[]` covering every red/yellow day. Cross-check a known red day against the emailed xlsx for the same month — colors must agree (same `classifyDay`).

- [ ] **Step 8: Commit**

```bash
git add src/lib/presenze/issues.ts src/lib/presenze/issues.test.ts src/app/api/presenze/review/route.ts && git commit -m "feat(presenze): review GET endpoint + pure issue flattening (revisione task 5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Review page UI `src/app/(dashboard)/presenze/page.tsx` + nav link

**Files:**
- Create: `src/app/(dashboard)/presenze/page.tsx`
- Modify: `src/components/Sidebar.tsx` (add admin nav link)

No automated test (client component hitting the API). Manual verification. The component mirrors the xlsx grid (employees × days) with red/yellow/absent cells, "solo rossi" + per-employee filters, an issue panel, a day editor that calls `PUT /api/presenze/review/day`, and a report banner.

- [ ] **Step 1: Implement the page**

```tsx
// src/app/(dashboard)/presenze/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Breadcrumb } from "@/components/Breadcrumb";
import { formatDateIt } from "@/lib/date-utils";

type DayStatus = "ok" | "under" | "over" | "absent" | "non_working";
interface DayClassification {
  date: string; status: DayStatus; scheduledHours: number; workedHours: number;
  leaveHours: number; effectiveHours: number;
  anomalies: { type: string; description: string; severity: "structural" | "possible" }[];
  isRed: boolean; isYellow: boolean;
}
interface ReviewEmployee {
  employeeId: string; name: string; displayName: string;
  days: DayClassification[]; overtimeTotal: number;
}
interface Issue {
  employeeId: string; employeeName: string; date: string; status: DayStatus;
  severity: "red" | "yellow"; reasons: string[]; recordIds: string[];
}
interface ReviewResponse {
  month: string; reportDay: number; reportEnabled: boolean; alreadySent: boolean;
  employees: ReviewEmployee[]; issues: Issue[];
}
interface DayRecord { id: string; type: string; declaredTime: string }

const TYPE_LABELS: Record<string, string> = {
  ENTRY: "Entrata", EXIT: "Uscita", PAUSE_START: "Inizio pausa", PAUSE_END: "Fine pausa",
  OVERTIME_START: "Inizio straordinario", OVERTIME_END: "Fine straordinario",
};
const MONTH_NAMES = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

function prevMonthValue(): string {
  const now = new Date();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function PresenzeReviewPage() {
  const [month, setMonth] = useState(prevMonthValue);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyRed, setOnlyRed] = useState(false);
  const [empFilter, setEmpFilter] = useState<string>("");
  const [editor, setEditor] = useState<{ employeeId: string; employeeName: string; date: string } | null>(null);
  const [editRecords, setEditRecords] = useState<DayRecord[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/presenze/review?month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ReviewResponse | null) => setData(d))
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const [y, m] = month.split("-").map(Number);
  const nDays = new Date(y, m, 0).getDate();
  const dayCols = useMemo(() => Array.from({ length: nDays }, (_, i) => i + 1), [nDays]);

  const employees = useMemo(() => {
    if (!data) return [];
    let list = data.employees;
    if (empFilter) list = list.filter((e) => e.employeeId === empFilter);
    if (onlyRed) list = list.filter((e) => e.days.some((d) => d.isRed));
    return list;
  }, [data, empFilter, onlyRed]);

  const issues = useMemo(() => {
    if (!data) return [];
    let list = data.issues;
    if (empFilter) list = list.filter((i) => i.employeeId === empFilter);
    if (onlyRed) list = list.filter((i) => i.severity === "red");
    return list;
  }, [data, empFilter, onlyRed]);

  function cellClass(d: DayClassification): string {
    if (d.isRed) return "bg-red-500 text-white";
    if (d.isYellow) return "bg-yellow-300 text-black";
    if (d.status === "non_working") return "bg-surface-container-low text-outline-variant";
    return "bg-surface-container-lowest text-on-surface";
  }

  function openEditor(employeeId: string, employeeName: string, date: string) {
    setEditor({ employeeId, employeeName, date });
    setEditRecords(null);
    fetch(`/api/records?employeeId=${employeeId}&date=${date}`)
      .then((r) => r.json())
      .then((recs: DayRecord[]) => setEditRecords(recs));
  }

  async function saveDay() {
    if (!editor || !editRecords) return;
    setSaving(true);
    try {
      const res = await fetch("/api/presenze/review/day", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: editor.employeeId,
          date: editor.date,
          records: editRecords.map((r) => ({
            ...(r.id.startsWith("new-") ? {} : { id: r.id }),
            type: r.type, declaredTime: r.declaredTime,
          })),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error(e.error || "Errore nel salvataggio");
        return;
      }
      toast.success("Modifiche salvate");
      setEditor(null);
      setEditRecords(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Revisione Presenze" }]} />

      {/* Month picker + banner */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
        />
        {data && (
          <div className="rounded-lg bg-surface-container-low px-4 py-2 text-sm text-on-surface-variant">
            Report di {MONTH_NAMES[m - 1]} {y} — parte il giorno {data.reportDay}
            {!data.reportEnabled && " · invio disabilitato"}
            {data.alreadySent && " · già inviato"}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyRed} onChange={(e) => setOnlyRed(e.target.checked)} />
          Solo rossi
        </label>
        {data && (
          <select
            value={empFilter}
            onChange={(e) => setEmpFilter(e.target.value)}
            className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
          >
            <option value="">Tutti i dipendenti</option>
            {data.employees.map((e) => (
              <option key={e.employeeId} value={e.employeeId}>{e.displayName}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-on-surface-variant">Caricamento...</div>
      ) : !data ? (
        <div className="text-error">Errore nel caricamento dei dati.</div>
      ) : (
        <>
          {/* Grid mirroring the xlsx (employees × days) */}
          <div className="overflow-x-auto rounded-lg bg-surface-container-lowest shadow-card">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface-container-low px-3 py-2 text-left">Dipendente</th>
                  {dayCols.map((d) => (
                    <th key={d} className="px-1 py-2 text-center tabular-nums">{d}</th>
                  ))}
                  <th className="px-2 py-2 text-center">Str.</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const byDay = new Map(emp.days.map((d) => [Number(d.date.slice(-2)), d]));
                  return (
                    <tr key={emp.employeeId} className="border-t border-surface-container">
                      <td className="sticky left-0 z-10 bg-surface-container-lowest px-3 py-1.5 font-semibold">{emp.displayName}</td>
                      {dayCols.map((d) => {
                        const c = byDay.get(d);
                        if (!c) return <td key={d} className="px-1 py-1.5 text-center text-outline-variant">·</td>;
                        const clickable = c.isRed || c.isYellow || c.status === "absent";
                        return (
                          <td
                            key={d}
                            title={c.anomalies.map((a) => a.description).join("; ") || c.status}
                            className={`px-1 py-1.5 text-center tabular-nums ${cellClass(c)} ${clickable ? "cursor-pointer hover:ring-2 hover:ring-primary" : ""}`}
                            onClick={() => clickable && openEditor(emp.employeeId, emp.displayName, c.date)}
                          >
                            {c.status === "non_working" ? "-" : c.status === "absent" ? "A" : c.effectiveHours || ""}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-center tabular-nums">{emp.overtimeTotal || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Issue panel */}
          <div className="rounded-lg bg-surface-container-lowest shadow-card">
            <div className="border-b border-surface-container px-4 py-3 font-semibold">
              Incoerenze ({issues.length})
            </div>
            <ul className="divide-y divide-surface-container">
              {issues.map((i) => (
                <li
                  key={`${i.employeeId}-${i.date}`}
                  className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-surface-container-low"
                  onClick={() => openEditor(i.employeeId, i.employeeName, i.date)}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${i.severity === "red" ? "bg-red-500" : "bg-yellow-400"}`} />
                  <span className="w-40 font-medium">{i.employeeName}</span>
                  <span className="w-24 tabular-nums">{formatDateIt(i.date)}</span>
                  <span className="text-on-surface-variant">{i.reasons.join(" · ")}</span>
                </li>
              ))}
              {issues.length === 0 && (
                <li className="px-4 py-6 text-center text-on-surface-variant">Nessuna incoerenza per i filtri selezionati.</li>
              )}
            </ul>
          </div>
        </>
      )}

      {/* Day editor modal */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditor(null)}>
          <div className="w-full max-w-lg rounded-lg bg-surface-container-lowest p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">{editor.employeeName} — {formatDateIt(editor.date)}</h3>
            {editRecords === null ? (
              <div className="py-8 text-center text-on-surface-variant">Caricamento...</div>
            ) : (
              <>
                <div className="space-y-2">
                  {editRecords.map((rec, idx) => (
                    <div key={rec.id} className="flex items-center gap-2">
                      <select
                        value={rec.type}
                        onChange={(e) => {
                          const u = [...editRecords]; u[idx] = { ...rec, type: e.target.value }; setEditRecords(u);
                        }}
                        className="rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs"
                      >
                        {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input
                        type="time"
                        value={rec.declaredTime}
                        onChange={(e) => {
                          const u = [...editRecords]; u[idx] = { ...rec, declaredTime: e.target.value }; setEditRecords(u);
                        }}
                        className="rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs tabular-nums"
                      />
                      <button
                        className="ml-auto rounded-full p-1 text-outline-variant hover:text-error"
                        onClick={() => setEditRecords(editRecords.filter((_, j) => j !== idx))}
                      >✕</button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-on-primary disabled:opacity-50" disabled={saving} onClick={saveDay}>
                    Salva
                  </button>
                  <button className="rounded-lg border border-outline-variant px-4 py-2 text-xs" onClick={() => setEditor(null)}>Annulla</button>
                  <button
                    className="ml-auto rounded-lg border border-dashed border-outline-variant px-3 py-2 text-xs"
                    onClick={() => setEditRecords([...(editRecords ?? []), { id: `new-${Date.now()}`, type: "ENTRY", declaredTime: "09:00" }])}
                  >+ Aggiungi</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the nav link in `Sidebar.tsx`**
  Add `ClipboardCheck` to the lucide import (line 7-15) and a nav item after the `/records` entry (line 29):

```tsx
  ClipboardCheck,
```

```tsx
  { href: "/presenze", label: "Revisione Presenze", icon: ClipboardCheck, color: "text-rose-500", adminOnly: true },
```

- [ ] **Step 3: Verify build**
  Run: `npm run build`
  Expected: build succeeds, `/presenze` route compiles.

- [ ] **Step 4: Manual verification**
  Run: `npm run dev`; as admin open `/presenze`.
  - Default month is the previous calendar month; the banner reads "Report di {mese} {anno} — parte il giorno {reportDay}".
  - The grid shows red/yellow/absent ("A") cells matching the emailed xlsx for that month; toggling "Solo rossi" hides non-red rows/issues; the per-employee select filters both grid and panel.
  - Clicking a red cell or an issue row opens the day editor; editing/adding/removing punches and clicking "Salva" calls `PUT /api/presenze/review/day`, then the grid reloads with corrected colors.
  - A duplicate type+time save surfaces the 409 toast.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/presenze/page.tsx" src/components/Sidebar.tsx && git commit -m "feat(presenze): review page UI (grid + issue panel + day editor) and nav link (revisione task 6)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Optional pre-send heads-up

**Files:**
- Create: `src/lib/presenze/pre-send-warning.ts` (pure `shouldWarnPreSend`)
- Test: `src/lib/presenze/pre-send-warning.test.ts`
- Modify: `src/lib/monthly-report-worker.ts` (wire the check into `runCheck`)

The predicate decides, given today's day-of-month, the configured `reportDay`, a `warnLeadDays` window, whether the report was already sent, and the count of red issues for the report month, whether to publish a heads-up. Wiring is manual-verification.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/presenze/pre-send-warning.test.ts
import { describe, it, expect } from "vitest";
import { shouldWarnPreSend } from "./pre-send-warning";

const base = { today: 3, reportDay: 5, warnLeadDays: 2, alreadySent: false, redIssueCount: 4 };

describe("shouldWarnPreSend", () => {
  it("warns inside the lead window with red issues", () => {
    expect(shouldWarnPreSend(base)).toBe(true); // 5 - 3 = 2 <= 2
  });

  it("does not warn outside the lead window (too early)", () => {
    expect(shouldWarnPreSend({ ...base, today: 1 })).toBe(false); // 5 - 1 = 4 > 2
  });

  it("does not warn on/after report day", () => {
    expect(shouldWarnPreSend({ ...base, today: 5 })).toBe(false);
    expect(shouldWarnPreSend({ ...base, today: 6 })).toBe(false);
  });

  it("does not warn when no red issues", () => {
    expect(shouldWarnPreSend({ ...base, redIssueCount: 0 })).toBe(false);
  });

  it("does not warn when already sent", () => {
    expect(shouldWarnPreSend({ ...base, alreadySent: true })).toBe(false);
  });

  it("warns exactly on the lead-window boundary", () => {
    expect(shouldWarnPreSend({ ...base, today: 4, warnLeadDays: 1 })).toBe(true); // 5 - 4 = 1 <= 1
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/lib/presenze/pre-send-warning.test.ts`
  Expected: FAIL — `pre-send-warning.ts` does not exist.

- [ ] **Step 3: Implement `pre-send-warning.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/lib/presenze/pre-send-warning.test.ts`
  Expected: PASS.

- [ ] **Step 5: Wire into the worker `runCheck`**
  In `src/lib/monthly-report-worker.ts`, add imports at top:

```ts
import { buildPresenzeMonthData } from "./excel-presenze";
import { flattenIssues } from "./presenze/issues";
import { shouldWarnPreSend } from "./presenze/pre-send-warning";
import { notificationsBus } from "./notifications-bus";
```

  In `runCheck`, after the `if (now.getDate() !== day) { ... return; }` early-return guard (line 91-94) is the wrong place — the heads-up must run on days BEFORE `day`. Insert a heads-up block right after reading `day` and `now` (after line 90), before the `now.getDate() !== day` guard:

```ts
    // Pre-send heads-up: a few days before reportDay, warn if red issues remain.
    const WARN_LEAD_DAYS = 2;
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const reportMonthStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    const lastSentForWarn = await getSetting("lastReportSent");
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    try {
      const monthData = await buildPresenzeMonthData(prevYear, prevMonth);
      const reviewEmployees = monthData.employees.map((emp) => {
        const days = [];
        const nDays = new Date(prevYear, prevMonth, 0).getDate();
        for (let d = 1; d <= nDays; d++) {
          const c = emp.classifications.get(d);
          if (c) days.push(c);
        }
        return { employeeId: emp.employeeId, name: emp.displayName, displayName: emp.displayName, days, overtimeTotal: emp.straordinari };
      });
      const redIssueCount = flattenIssues(reviewEmployees).filter((i) => i.severity === "red").length;
      if (
        shouldWarnPreSend({
          today: now.getDate(),
          reportDay: day,
          warnLeadDays: WARN_LEAD_DAYS,
          alreadySent: lastSentForWarn === currentYM,
          redIssueCount,
        })
      ) {
        const warnedKey = `presenzeReviewWarned-${reportMonthStr}`;
        if ((await getSetting(warnedKey)) !== "true") {
          notificationsBus.publish({
            employeeId: "",
            employeeName: "Revisione Presenze",
            action: "ANOMALY_RESOLVED",
            time: "",
            date: `${reportMonthStr}-01`,
            details: { recordType: "PRESENZE_REVIEW_WARNING" },
          });
          await setSetting(warnedKey, "true");
          logger.warn({ worker: WORKER, reportMonthStr, redIssueCount }, "pre-send heads-up: red issues remain");
        }
      }
    } catch (err) {
      logger.error({ worker: WORKER, err: String(err) }, "pre-send heads-up check failed");
    }
```

> The `presenzeReviewWarned-<month>` setting de-dupes so the hourly tick warns once per report month. It does not block the auto-send (D1) — `generateAndSend` still fires on `reportDay`.

- [ ] **Step 6: Verify build + full suite**
  Run: `npm run build && npm test`
  Expected: build succeeds; all tests pass.

- [ ] **Step 7: Manual verification**
  In dev, temporarily set `monthlyReportDay` so that `reportDay - today` falls within `WARN_LEAD_DAYS`, ensure the previous month has at least one red day and `lastReportSent` is not the current YYYY-MM, then trigger a worker tick (restart dev or wait for the hourly tick). Expected: a single `notificationsBus` event with `details.recordType === "PRESENZE_REVIEW_WARNING"` and a warn log line; subsequent ticks within the same month do not re-warn (the `presenzeReviewWarned-<month>` flag is set).

- [ ] **Step 8: Commit**

```bash
git add src/lib/presenze/pre-send-warning.ts src/lib/presenze/pre-send-warning.test.ts src/lib/monthly-report-worker.ts && git commit -m "feat(presenze): pre-send heads-up when red issues remain before reportDay (revisione task 7)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

Spec coverage check against `2026-06-09-revisione-presenze-design.md`:

- **D1 (separate page, auto-send unchanged):** Task 6 adds `/presenze`; Tasks 2 and 7 leave `generateAndSend`'s schedule/trigger untouched — the heads-up only publishes a bus event. ✓
- **D2 (edits hit real `AttendanceRecord`):** Task 4's batch endpoint creates/updates/deletes real records in a `$transaction`; no override layer. ✓
- **D3 / A1 ("rosso" = structural + possible + ore ≠ orario + unjustified absence):** Task 1 `classifyDay` encodes `under`/`over`/`absent`/structural `isRed`, possible-only `isYellow`; Task 5 `flattenIssues` surfaces them. ✓
- **D4 (page == report, single computation path):** Task 2 routes both the xlsx and the review API through `classifyDay`/`buildPresenzeMonthData`; the regression test (`excel-presenze.classify.test.ts`) proves byte-identical colors. ✓
- **§5.1 rules incl. `isActiveOnDay=false → non_working`, `isNonWorkingDay → non_working`, `absent` when working day + no records + no leave:** all encoded and tested in Task 1. The Feature 2 `isActiveOn` is consumed in Task 2. ✓
- **§5.4 batch endpoint semantics (diff, 409 on collision, MANUAL/`[Revisione presenze]` create contract, single recompute, one bus event, audit per change):** Task 4 route + `planDayBatch`. ✓
- **§5.4 audit model mirroring `LeaveRequestEdit` (old*/new* snapshot, `changedFields`, `editedById`, `source`, indexes) + `User.recordEdits` relation:** Task 3 schema + wired into POST/PUT/DELETE and the batch endpoint. ✓
- **Records edit gaps closed:** Task 3 extracts `recomputeAnomaliesForDates` and adds it to POST and DELETE (previously only PUT); Task 4 repoints the N-parallel-PUT UI loop to one transactional call. ✓
- **§5.2 review GET shape (`month`, `reportDay`, `reportEnabled`, `alreadySent`, `employees[]`, `issues[]`):** Task 5 route + `flattenIssues`. ✓
- **§5.3 UI (month picker default previous month, xlsx-mirror grid with clickable red/yellow/absent cells, "solo rossi" + per-employee filters, issue panel, day editor, report banner, nav link):** Task 6. ✓
- **§5.3 pre-send heads-up (D1, optional, included):** Task 7 pure predicate + worker wiring. ✓
- **§7 edge cases:** half-day/hourly leave coverage flows through `leaveHours` (Task 2 derives it from the F/P column which already encodes the existing ROL/half-day mapping); full-day-leave dates stay non-red (`syncAnomalies` skip preserved, unchanged); absent day opens an empty editor (Task 6); month-boundary default matches the worker's `prevMonth` (Tasks 5 and 7); already-sent month still editable (no gate). ✓
- **Type/name consistency:** `DayClassification`, `DayStatus`, `classifyDay`, `COMPUTED_TYPES`, `recomputeAnomaliesForDates`, `computeRecordDiff`, `planDayBatch`, `flattenIssues`, `Issue`, `ReviewEmployee`, `shouldWarnPreSend` are defined once and referenced by the same names across all downstream tasks. ✓
- **Repo conventions:** `npm run db:push` + `npm run db:generate` (no `prisma migrate`); pure-lib-function + thin-route + manual-verification for Prisma-touching endpoints (mirrors the `computeLeaveBalanceFromData` pattern); `npx vitest run <path>` commands; commit per task. ✓
