import { describe, it, expect } from "vitest";
import { computeMonteTrend, type MonteTrendEmployeeInput } from "./monte-trend";

type ScheduleRow = {
  dayOfWeek: number;
  block1Start: string | null;
  block1End: string | null;
  block2Start: string | null;
  block2End: string | null;
};

function ftSchedule(): ScheduleRow[] {
  return [1, 2, 3, 4, 5].map((dow) => ({
    dayOfWeek: dow, block1Start: "09:00", block1End: "13:00", block2Start: "14:00", block2End: "18:00",
  }));
}

function ftEmployee(id: string, name: string, hireDate: Date | null = new Date("2020-01-01")): MonteTrendEmployeeInput {
  return {
    id, name,
    employee: { id, hireDate, terminationDate: null, contractType: "FULL_TIME", schedule: ftSchedule() },
    balance: null,
    leaves: [],
  };
}

describe("computeMonteTrend", () => {
  it("plots one point per month up to the current month", () => {
    const t = computeMonteTrend([ftEmployee("e1", "Mario")], 2026, new Date("2026-03-15T12:00:00"));
    expect(t.months).toEqual(["Gen", "Feb", "Mar"]);
    expect(t.series[0].points).toHaveLength(3);
  });

  it("residual monte accrues monthly (vac days + rol hours/8), no leaves", () => {
    // FT accrual: +2 vac days & +2 rol h per month. Monte days = vac + rol/8.
    // Jan: 2 + 2/8 = 2.25 · Feb: 4 + 4/8 = 4.5 · Mar: 6 + 6/8 = 6.75
    const t = computeMonteTrend([ftEmployee("e1", "Mario")], 2026, new Date("2026-03-15T12:00:00"));
    expect(t.series[0].points).toEqual([2.25, 4.5, 6.75]);
  });

  it("a past leave reduces the monte from the month it falls in", () => {
    const e = ftEmployee("e1", "Mario");
    // 2 working days of ferie in February (10-11 Feb 2026 = Tue/Wed).
    e.leaves = [{ type: "VACATION", startDate: "2026-02-10", endDate: "2026-02-11", hours: null, timeSlots: null, source: "MANAGER" }];
    const t = computeMonteTrend([e], 2026, new Date("2026-03-15T12:00:00"));
    // Jan unaffected (2.25). Feb: 4 + 0.5 − 2 = 2.5. Mar: 6 + 0.75 − 2 = 4.75.
    expect(t.series[0].points).toEqual([2.25, 2.5, 4.75]);
  });

  it("a FUTURE leave does NOT reduce the as-of monte (only goduto counts)", () => {
    const e = ftEmployee("e1", "Mario");
    // Leave in the future relative to the whole plotted window.
    e.leaves = [{ type: "VACATION", startDate: "2026-09-07", endDate: "2026-09-11", hours: null, timeSlots: null, source: "MANAGER" }];
    const t = computeMonteTrend([e], 2026, new Date("2026-03-15T12:00:00"));
    expect(t.series[0].points).toEqual([2.25, 4.5, 6.75]); // identical to no-leave case
  });

  it("company total sums non-null employee points per month", () => {
    const t = computeMonteTrend([ftEmployee("e1", "A"), ftEmployee("e2", "B")], 2026, new Date("2026-02-15T12:00:00"));
    expect(t.total).toEqual([4.5, 9]); // 2.25*2, 4.5*2
  });

  it("points before the hire month are null and excluded from the total", () => {
    const hired = ftEmployee("e2", "Late", new Date("2026-02-15"));
    const t = computeMonteTrend([ftEmployee("e1", "Early"), hired], 2026, new Date("2026-03-15T12:00:00"));
    // Late hire: null in Jan (hired Feb 15 > Jan 31), value from Feb onward.
    expect(t.series[1].points[0]).toBeNull();
    expect(t.series[1].points[1]).not.toBeNull();
    // Jan total = only Early (2.25).
    expect(t.total[0]).toBe(2.25);
  });

  it("future year → no months", () => {
    const t = computeMonteTrend([ftEmployee("e1", "Mario")], 2027, new Date("2026-03-15T12:00:00"));
    expect(t.months).toEqual([]);
    expect(t.series[0].points).toEqual([]);
  });
});
