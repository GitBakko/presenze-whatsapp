import { describe, it, expect } from "vitest";
import { computePool, planAmortization } from "./amortization";

const base = {
  id: "e1",
  contractType: "FULL_TIME",
  schedule: [] as Array<{ dayOfWeek: number; block1Start: string | null; block1End: string | null; block2Start: string | null; block2End: string | null }>,
  terminationDate: null as Date | null,
  occupiedDates: new Set<string>(),
};

function ftSched() {
  return [1, 2, 3, 4, 5].map((d) => ({
    dayOfWeek: d, block1Start: "09:00", block1End: "13:00", block2Start: "14:00", block2End: "18:00",
  }));
}

describe("computePool", () => {
  it("unifies vacation days + ROL hours into whole days (FULL_TIME, 8h)", () => {
    // 5 vacation days = 40h + 8h ROL = 48h => 6 whole days, 0 scrap
    const p = computePool({ ...base, vacationRemaining: 5, rolRemaining: 8 });
    expect(p.vacWholeDays).toBe(5);
    expect(p.rolWholeDays).toBe(1);
    expect(p.scrapHours).toBe(0);
    expect(p.totalDays).toBe(6);
  });

  it("rolls vacation fraction into the ROL pool and leaves indivisible ROL as scrap", () => {
    // 2.5 vac days => 2 whole + 0.5*8=4h into pool; rol 5h => pool 9h => 1 day + 1h scrap
    const p = computePool({ ...base, vacationRemaining: 2.5, rolRemaining: 5 });
    expect(p.vacWholeDays).toBe(2);
    expect(p.rolWholeDays).toBe(1);
    expect(p.scrapHours).toBe(1);
    expect(p.totalDays).toBe(3);
  });

  it("part-time uses 4h/day", () => {
    const p = computePool({ ...base, contractType: "PART_TIME", vacationRemaining: 3, rolRemaining: 4 });
    expect(p.vacWholeDays).toBe(3);
    expect(p.rolWholeDays).toBe(1);
    expect(p.totalDays).toBe(4);
  });

  it("zero residual → zero days", () => {
    const p = computePool({ ...base, vacationRemaining: 0, rolRemaining: 0 });
    expect(p.totalDays).toBe(0);
  });

  it("negative residual is clamped to zero (no negative days)", () => {
    const p = computePool({ ...base, vacationRemaining: -3, rolRemaining: -10 });
    expect(p.totalDays).toBe(0);
  });
});

describe("planAmortization", () => {
  const now = new Date("2026-12-01T12:00:00");
  const yearEnd = "2026-12-31";

  it("schedules exactly totalDays working days within the horizon", () => {
    const plan = planAmortization([
      { ...base, schedule: ftSched(), vacationRemaining: 3, rolRemaining: 0 },
    ], now, yearEnd);
    const days = plan.get("e1")!;
    expect(days.length).toBe(3);
    days.forEach((d) => {
      expect(d.date > "2026-12-01").toBe(true);
      expect(d.date <= "2026-12-31").toBe(true);
      expect(d.type).toBe("VACATION");
    });
  });

  it("whole-day ROL multiples are booked as ferie days, never hourly permits", () => {
    // 1 vac day + 8h ROL = 2 whole days; BOTH must be VACATION (no ROL permits).
    const plan = planAmortization([
      { ...base, schedule: ftSched(), vacationRemaining: 1, rolRemaining: 8 },
    ], now, yearEnd);
    const days = plan.get("e1")!;
    expect(days.length).toBe(2);
    expect(days.every((d) => d.type === "VACATION")).toBe(true);
    expect(days.some((d) => (d as { hours?: number }).hours != null)).toBe(false);
  });

  it("avoids collisions between two employees when space allows", () => {
    const plan = planAmortization([
      { ...base, id: "e1", schedule: ftSched(), vacationRemaining: 3, rolRemaining: 0 },
      { ...base, id: "e2", schedule: ftSched(), vacationRemaining: 3, rolRemaining: 0, occupiedDates: new Set<string>() },
    ], now, yearEnd);
    const d1 = new Set(plan.get("e1")!.map((d) => d.date));
    const overlap = plan.get("e2")!.filter((d) => d1.has(d.date));
    expect(overlap.length).toBe(0);
  });

  it("never schedules on or after terminationDate", () => {
    const plan = planAmortization([
      { ...base, schedule: ftSched(), terminationDate: new Date("2026-12-10"), vacationRemaining: 20, rolRemaining: 0 },
    ], now, yearEnd);
    plan.get("e1")!.forEach((d) => expect(d.date < "2026-12-10").toBe(true));
  });

  it("skips dates the employee already has occupied", () => {
    const plan = planAmortization([
      { ...base, schedule: ftSched(), vacationRemaining: 2, rolRemaining: 0, occupiedDates: new Set<string>(["2026-12-02"]) },
    ], now, yearEnd);
    expect(plan.get("e1")!.some((d) => d.date === "2026-12-02")).toBe(false);
  });

  it("zero-residual employee gets an empty plan", () => {
    const plan = planAmortization([
      { ...base, schedule: ftSched(), vacationRemaining: 0, rolRemaining: 0 },
    ], now, yearEnd);
    expect(plan.get("e1")!.length).toBe(0);
  });

  it("soft-overflows: when free days run out, still schedules the full count (collisions allowed)", () => {
    // Tiny horizon (late Dec) with only a handful of working days; two employees
    // each need 5 days → forced overlap, but each must still get its 5 days.
    const lateNow = new Date("2026-12-22T12:00:00");
    const plan = planAmortization([
      { ...base, id: "e1", schedule: ftSched(), vacationRemaining: 5, rolRemaining: 0 },
      { ...base, id: "e2", schedule: ftSched(), vacationRemaining: 5, rolRemaining: 0, occupiedDates: new Set<string>() },
    ], lateNow, yearEnd);
    expect(plan.get("e1")!.length).toBe(5);
    expect(plan.get("e2")!.length).toBe(5);
    const d1 = new Set(plan.get("e1")!.map((d) => d.date));
    const overlap = plan.get("e2")!.filter((d) => d1.has(d.date));
    expect(overlap.length).toBeGreaterThan(0); // overlap was unavoidable here
  });
});
