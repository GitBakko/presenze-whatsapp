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
  it("plots the full year and marks the current month", () => {
    const t = computeMonteTrend([ftEmployee("e1", "Mario")], 2026, new Date("2026-03-15T12:00:00"));
    expect(t.months).toEqual(["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]);
    expect(t.series[0].points).toHaveLength(12);
    expect(t.currentMonthLabel).toBe("Mar");
  });

  it("residual monte rises monthly with accrual (vac days + rol hours/8), no leaves", () => {
    // FT accrual: +2 vac days & +4 rol h per month. Monte days = vac + rol/8.
    // Jan 2.5 · Mar 7.5 · projected forward to Dec 24 + 6 = 30.
    const t = computeMonteTrend([ftEmployee("e1", "Mario")], 2026, new Date("2026-03-15T12:00:00"));
    const p = t.series[0].points;
    expect(p[0]).toBe(2.5);
    expect(p[2]).toBe(7.5);
    expect(p[11]).toBe(30);
  });

  it("a FUTURE planned leave PROJECTS a burn-down from its month onward", () => {
    const e = ftEmployee("e1", "Mario");
    // 5 working days of ferie in September (7-11 Sep 2026 = Mon-Fri) — future vs Mar.
    e.leaves = [{ type: "VACATION", startDate: "2026-09-07", endDate: "2026-09-11", hours: null, timeSlots: null, source: "PREDICTOR" }];
    const t = computeMonteTrend([e], 2026, new Date("2026-03-15T12:00:00"));
    const p = t.series[0].points;
    // August (index 7) is before the leave → unaffected (16 vac + 4 rol = 20).
    expect(p[7]).toBe(20);
    // September (index 8) onward the 5 planned days are consumed: 20 + 2.5 − 5 = 17.5.
    expect(p[8]).toBe(17.5);
    expect(p[8]!).toBeLessThan(p[7]!); // the line turns DOWN — the amortization is visible
  });

  it("company total sums non-null employee points per month", () => {
    const t = computeMonteTrend([ftEmployee("e1", "A"), ftEmployee("e2", "B")], 2026, new Date("2026-02-15T12:00:00"));
    expect(t.total[0]).toBe(5);  // 2.5 * 2
    expect(t.total[1]).toBe(10); // 5 * 2
  });

  it("points before the hire month are null and excluded from the total", () => {
    const hired = ftEmployee("e2", "Late", new Date("2026-02-15"));
    const t = computeMonteTrend([ftEmployee("e1", "Early"), hired], 2026, new Date("2026-03-15T12:00:00"));
    expect(t.series[1].points[0]).toBeNull(); // hired Feb 15 > Jan 31
    expect(t.series[1].points[1]).not.toBeNull();
    expect(t.total[0]).toBe(2.5); // Jan = only Early
  });

  it("future year → no months", () => {
    const t = computeMonteTrend([ftEmployee("e1", "Mario")], 2027, new Date("2026-03-15T12:00:00"));
    expect(t.months).toEqual([]);
    expect(t.series[0].points).toEqual([]);
    expect(t.currentMonthLabel).toBeNull();
  });
});
