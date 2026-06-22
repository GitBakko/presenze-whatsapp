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
    // Report color is anomaly-blind: an exact day stays uncolored in the xlsx.
    expect(c.isReportRed).toBe(false);
    expect(c.isReportYellow).toBe(false);
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
    // Report color is anomaly-blind: an exact day stays uncolored in the xlsx.
    expect(c.isReportRed).toBe(false);
    expect(c.isReportYellow).toBe(false);
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

describe("classifyDay — daily cap overage (worked + leave > cap)", () => {
  it("without raw args the overage check is a no-op", () => {
    const c = classifyDay({ ...base, dailyStats: statsWith({ hoursWorked: 8 }) });
    expect(c.rawEffectiveHours).toBe(8); // defaults to effectiveHours
    expect(c.dailyCapHours).toBe(8); // defaults to scheduledHours
    expect(c.exceedsDailyCap).toBe(false);
  });

  it("capped ROL case: printed totale lands on 8 (ok) but raw worked+leave is 10 -> yellow", () => {
    // buildPresenzeMonthData caps ordinario to 4 so the cell prints 8; the raw
    // sum (6 worked + 4 ROL) is the overage the report hides.
    const c = classifyDay({
      ...base,
      dailyStats: statsWith({ hoursWorked: 4 }), // printed (capped) hours
      leaveHours: 4,
      rawEffectiveHours: 10,
      dailyCapHours: 8,
    });
    expect(c.status).toBe("ok"); // printed totale == scheduled
    expect(c.isRed).toBe(false);
    expect(c.exceedsDailyCap).toBe(true);
    expect(c.isYellow).toBe(true); // overage lights the cell even on an "ok" day
    expect(c.rawEffectiveHours).toBe(10);
    // Emailed report stays byte-identical: overage must NOT color the xlsx.
    expect(c.isReportRed).toBe(false);
    expect(c.isReportYellow).toBe(false);
  });

  it("full-day leave with stray worked hours -> overage flagged", () => {
    const c = classifyDay({
      ...base,
      dailyStats: null, // worked hours dropped from the printed cell
      leaveHours: 8,
      rawEffectiveHours: 13, // 5 worked + 8 full-day ferie
      dailyCapHours: 8,
    });
    expect(c.exceedsDailyCap).toBe(true);
    expect(c.isYellow).toBe(true);
  });

  it("raw sum exactly on the cap is not an overage (epsilon)", () => {
    const c = classifyDay({
      ...base,
      dailyStats: statsWith({ hoursWorked: 8 }),
      rawEffectiveHours: 8,
      dailyCapHours: 8,
    });
    expect(c.exceedsDailyCap).toBe(false);
  });

  it("part-time cap (4h): worked 3 + ROL 2 = 5 > 4 -> overage", () => {
    const c = classifyDay({
      ...base,
      scheduledHours: 4,
      dailyStats: statsWith({ hoursWorked: 2 }),
      leaveHours: 2,
      rawEffectiveHours: 5,
      dailyCapHours: 4,
    });
    expect(c.exceedsDailyCap).toBe(true);
    expect(c.isYellow).toBe(true);
  });

  it("non-working day never flags an overage even with raw hours passed", () => {
    const c = classifyDay({
      ...base,
      isNonWorkingDay: true,
      scheduledHours: 0,
      rawEffectiveHours: 12,
      dailyCapHours: 8,
    });
    expect(c.status).toBe("non_working");
    expect(c.dailyCapHours).toBe(0);
    expect(c.exceedsDailyCap).toBe(false);
  });

  it("overage does NOT override an under day's red", () => {
    const c = classifyDay({
      ...base,
      dailyStats: statsWith({ hoursWorked: 5 }),
      rawEffectiveHours: 9,
      dailyCapHours: 8,
    });
    expect(c.status).toBe("under");
    expect(c.isRed).toBe(true);
    expect(c.isYellow).toBe(false); // red wins
  });
});
