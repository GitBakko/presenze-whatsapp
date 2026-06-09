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
  it("isReportRed/isReportYellow per day equal the legacy inline rule for the fixture month", async () => {
    const { classifyEmployeeDays } = await import("./excel-presenze");
    const emp = fixtureEmployee();
    const year = 2026, month = 5;
    const nDays = new Date(year, month, 0).getDate();
    const classifications = classifyEmployeeDays(emp, year, month, () => true);

    for (let d = 1; d <= nDays; d++) {
      const dateStr = `${year}-05-${String(d).padStart(2, "0")}`;
      const legacy = legacyColor(emp, d, dateStr);
      const c = classifications.get(d)!;
      // The xlsx fill reads isReportRed/isReportYellow (hours-only, legacy rule).
      const newColor = c.isReportRed ? "red" : c.isReportYellow ? "yellow" : null;
      expect(newColor, `day ${d} (${dateStr})`).toBe(legacy);
    }
  });

  it("builder path: report color uses PRINTED oreOrdinario, NOT raw stats.hoursWorked", async () => {
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
    expect(c.isReportRed).toBe(true);
    expect(c.isReportYellow).toBe(false);
  });

  it("report color IGNORES anomalies: a structural anomaly on an EXACT day stays uncolored", async () => {
    // Production divergence guard. In production buildPresenzeMonthData feeds a real
    // statsForDay closure whose stats carry anomalies (MISSING_EXIT, etc.). The legacy
    // inline rule colored purely on totale-vs-scheduled and NEVER on anomalies. The
    // xlsx report (isReportRed/isReportYellow) must reproduce that exactly: an exact day
    // (totale == scheduled) with a structural anomaly stays uncolored in the report,
    // while the review-UI signal (isRed) flags it.
    const { classifyEmployeeDays } = await import("./excel-presenze");
    const emp = fixtureEmployee();
    // day 5 is exact (O=8, scheduled 8) -> legacy: no fill.
    const classifications = classifyEmployeeDays(
      emp,
      2026,
      5,
      () => true,
      (d) =>
        d === 5
          ? ({
              employeeId: "e", employeeName: "x", date: "2026-05-05",
              hoursWorked: 8, hoursWorkedMsg: 0, pauseMinutes: 0, pauses: [],
              morningDelay: 0, afternoonDelay: 0, overtime: 0, overtimeBlocks: [],
              hasAnomaly: true,
              anomalies: [{ type: "MISSING_EXIT", description: "Entrata senza uscita" }],
              entries: [], exits: [],
            } as unknown as import("@/lib/calculator").DailyStats)
          : null,
    );
    const c = classifications.get(5)!;
    // Report (xlsx) color: byte-identical to legacy -> uncolored on an exact day.
    expect(c.isReportRed).toBe(false);
    expect(c.isReportYellow).toBe(false);
    // Review-UI signal still flags the structural anomaly as red.
    expect(c.isRed).toBe(true);
    expect(c.anomalies.some((a) => a.type === "MISSING_EXIT")).toBe(true);
  });

  it("report color IGNORES anomalies: a possible anomaly on an OVER day stays YELLOW (not promoted/demoted)", async () => {
    const { classifyEmployeeDays } = await import("./excel-presenze");
    const emp = fixtureEmployee();
    // day 6 is over (O=9, scheduled 8) -> legacy: yellow. A possible anomaly there
    // must keep the report yellow (legacy never reads anomalies for color).
    const classifications = classifyEmployeeDays(
      emp,
      2026,
      5,
      () => true,
      (d) =>
        d === 6
          ? ({
              employeeId: "e", employeeName: "x", date: "2026-05-06",
              hoursWorked: 9, hoursWorkedMsg: 0, pauseMinutes: 0, pauses: [],
              morningDelay: 0, afternoonDelay: 0, overtime: 0, overtimeBlocks: [],
              hasAnomaly: true,
              anomalies: [{ type: "TIME_OVERLAP", description: "Uscita prima di entrata" }],
              entries: [], exits: [],
            } as unknown as import("@/lib/calculator").DailyStats)
          : null,
    );
    const c = classifications.get(6)!;
    expect(c.isReportRed).toBe(false);
    expect(c.isReportYellow).toBe(true);
  });
});
