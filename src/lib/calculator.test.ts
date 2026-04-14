import { describe, it, expect } from "vitest";
import { calculateDailyStats, aggregateMonthlyStats } from "./calculator";
import type { DailyRecord, EmployeeScheduleDay } from "./calculator";

const DEFAULT_SCHEDULE: EmployeeScheduleDay = {
  block1Start: "09:00",
  block1End: "13:00",
  block2Start: "14:30",
  block2End: "18:30",
};

function makeRecord(
  records: { type: string; declaredTime: string; messageTime?: string }[]
): DailyRecord {
  return {
    employeeId: "emp1",
    employeeName: "Mario Rossi",
    date: "2025-04-14",
    records: records.map((r) => ({
      type: r.type as DailyRecord["records"][0]["type"],
      declaredTime: r.declaredTime,
      messageTime: r.messageTime ?? r.declaredTime,
    })),
  };
}

describe("calculateDailyStats", () => {
  describe("hours worked", () => {
    it("calculates simple entry-exit pair", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00" },
        { type: "EXIT", declaredTime: "13:00" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.hoursWorked).toBe(4);
      expect(stats.entries).toEqual(["09:00"]);
      expect(stats.exits).toEqual(["13:00"]);
    });

    it("calculates two entry-exit pairs (full day)", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00" },
        { type: "EXIT", declaredTime: "13:00" },
        { type: "ENTRY", declaredTime: "14:30" },
        { type: "EXIT", declaredTime: "18:30" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.hoursWorked).toBe(8);
    });

    it("subtracts pause from hours worked", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00" },
        { type: "EXIT", declaredTime: "13:00" },
        { type: "PAUSE_START", declaredTime: "10:00" },
        { type: "PAUSE_END", declaredTime: "10:15" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.hoursWorked).toBe(3.75); // 4h - 15min
      expect(stats.pauseMinutes).toBe(15);
      expect(stats.pauses).toHaveLength(1);
    });
  });

  describe("delays", () => {
    it("detects morning delay beyond tolerance", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:30" },
        { type: "EXIT", declaredTime: "13:00" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      // 30 min late, tolerance is 15 → delay = 30 (from schedule start)
      expect(stats.morningDelay).toBe(30);
    });

    it("does not flag delay within tolerance", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:10" },
        { type: "EXIT", declaredTime: "13:00" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.morningDelay).toBe(0);
    });

    it("detects afternoon delay", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00" },
        { type: "EXIT", declaredTime: "13:00" },
        { type: "ENTRY", declaredTime: "15:00" },
        { type: "EXIT", declaredTime: "18:30" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      // 15:00 vs 14:30 schedule = 30 min, beyond tolerance → delay = 30
      expect(stats.afternoonDelay).toBe(30);
    });
  });

  describe("overtime", () => {
    it("calculates auto overtime (hours exceed contracted)", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00" },
        { type: "EXIT", declaredTime: "13:00" },
        { type: "ENTRY", declaredTime: "14:30" },
        { type: "EXIT", declaredTime: "19:30" }, // 1h extra
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.overtime).toBe(1); // 9h - 8h contracted
    });

    it("tracks explicit overtime blocks", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00" },
        { type: "EXIT", declaredTime: "18:30" },
        { type: "OVERTIME_START", declaredTime: "18:30" },
        { type: "OVERTIME_END", declaredTime: "19:30" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.overtimeBlocks).toHaveLength(1);
      expect(stats.overtimeBlocks[0].minutes).toBe(60);
      expect(stats.overtimeBlocks[0].explicit).toBe(true);
    });
  });

  describe("anomalies", () => {
    it("flags entry without exit", () => {
      const dr = makeRecord([{ type: "ENTRY", declaredTime: "09:00" }]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.hasAnomaly).toBe(true);
      expect(stats.anomalies.some((a) => a.type === "MISSING_EXIT")).toBe(true);
    });

    it("flags exit without entry", () => {
      const dr = makeRecord([{ type: "EXIT", declaredTime: "18:00" }]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.anomalies.some((a) => a.type === "MISSING_ENTRY")).toBe(true);
    });

    it("flags mismatched entry/exit counts", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00" },
        { type: "EXIT", declaredTime: "13:00" },
        { type: "ENTRY", declaredTime: "14:30" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.anomalies.some((a) => a.type === "MISMATCHED_PAIRS")).toBe(true);
    });

    it("flags exit before entry", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "13:00" },
        { type: "EXIT", declaredTime: "09:00" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.anomalies.some((a) => a.type === "TIME_OVERLAP")).toBe(true);
    });

    it("flags pause without end", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00" },
        { type: "EXIT", declaredTime: "13:00" },
        { type: "PAUSE_START", declaredTime: "10:00" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.anomalies.some((a) => a.type === "PAUSE_NO_END")).toBe(true);
    });

    it("no anomalies for clean full day", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00" },
        { type: "EXIT", declaredTime: "13:00" },
        { type: "ENTRY", declaredTime: "14:30" },
        { type: "EXIT", declaredTime: "18:30" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.hasAnomaly).toBe(false);
    });
  });

  describe("message time tracking", () => {
    it("tracks hours from both declared and message times", () => {
      const dr = makeRecord([
        { type: "ENTRY", declaredTime: "09:00", messageTime: "09:05" },
        { type: "EXIT", declaredTime: "13:00", messageTime: "13:02" },
      ]);
      const stats = calculateDailyStats(dr, DEFAULT_SCHEDULE);
      expect(stats.hoursWorked).toBe(4); // declared
      expect(stats.hoursWorkedMsg).toBeCloseTo(3.95, 1); // message time: ~3h57min
    });
  });
});

describe("aggregateMonthlyStats", () => {
  it("aggregates multiple daily stats", () => {
    const daily = [
      calculateDailyStats(
        makeRecord([
          { type: "ENTRY", declaredTime: "09:00" },
          { type: "EXIT", declaredTime: "13:00" },
          { type: "ENTRY", declaredTime: "14:30" },
          { type: "EXIT", declaredTime: "18:30" },
        ]),
        DEFAULT_SCHEDULE
      ),
      calculateDailyStats(
        makeRecord([
          { type: "ENTRY", declaredTime: "09:00" },
          { type: "EXIT", declaredTime: "13:00" },
          { type: "ENTRY", declaredTime: "14:30" },
          { type: "EXIT", declaredTime: "19:30" },
        ]),
        DEFAULT_SCHEDULE
      ),
    ];

    const agg = aggregateMonthlyStats(daily);
    expect(agg.totalDays).toBe(2);
    expect(agg.totalHours).toBe(17); // 8 + 9
    expect(agg.averageHours).toBe(8.5);
    expect(agg.totalOvertime).toBe(1); // 1h from second day
    expect(agg.anomalies).toBe(0);
  });
});
