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
