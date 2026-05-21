import { describe, it, expect } from "vitest";
import { countWorkDays, expandToWorkingDays, isWorkingDay } from "../working-days";

const FULL_TIME = new Map<number, unknown>([
  [1, {}], [2, {}], [3, {}], [4, {}], [5, {}],
]);

const PART_TIME_WT = new Map<number, unknown>([
  [3, {}], [4, {}],
]);

describe("isWorkingDay", () => {
  it("returns false for weekends regardless of schedule", () => {
    expect(isWorkingDay("2026-05-23", FULL_TIME)).toBe(false);
    expect(isWorkingDay("2026-05-24", FULL_TIME)).toBe(false);
  });

  it("returns false for national holidays on working days", () => {
    expect(isWorkingDay("2026-05-01", FULL_TIME)).toBe(false);
    expect(isWorkingDay("2026-04-06", FULL_TIME)).toBe(false);
  });

  it("returns false for San Feliciano 24/01 (local) on a working day", () => {
    expect(isWorkingDay("2028-01-24", FULL_TIME)).toBe(false);
  });

  it("returns true for normal working days", () => {
    expect(isWorkingDay("2026-05-22", FULL_TIME)).toBe(true);
    expect(isWorkingDay("2026-05-25", FULL_TIME)).toBe(true);
  });

  it("returns false for days outside part-time schedule", () => {
    expect(isWorkingDay("2026-05-25", PART_TIME_WT)).toBe(false);
    expect(isWorkingDay("2026-05-27", PART_TIME_WT)).toBe(true);
    expect(isWorkingDay("2026-05-28", PART_TIME_WT)).toBe(true);
  });
});

describe("countWorkDays", () => {
  it("counts only working days, excluding weekends in between (the bug case)", () => {
    expect(countWorkDays("2026-05-22", "2026-05-25", FULL_TIME)).toBe(2);
  });

  it("excludes national holidays in the middle of the range", () => {
    expect(countWorkDays("2026-04-30", "2026-05-04", FULL_TIME)).toBe(2);
  });

  it("does not double-penalize a holiday that falls on a weekend", () => {
    expect(countWorkDays("2026-04-24", "2026-04-27", FULL_TIME)).toBe(2);
  });

  it("returns 1 for a single working day", () => {
    expect(countWorkDays("2026-05-22", "2026-05-22", FULL_TIME)).toBe(1);
  });

  it("returns 0 for a single weekend day", () => {
    expect(countWorkDays("2026-05-23", "2026-05-23", FULL_TIME)).toBe(0);
  });

  it("returns 0 for inverted range", () => {
    expect(countWorkDays("2026-05-25", "2026-05-22", FULL_TIME)).toBe(0);
  });

  it("respects part-time schedule", () => {
    expect(countWorkDays("2026-05-25", "2026-05-29", PART_TIME_WT)).toBe(2);
  });
});

describe("expandToWorkingDays", () => {
  it("returns only the working dates in the range", () => {
    const result = expandToWorkingDays("2026-05-22", "2026-05-25", FULL_TIME);
    expect(result).toEqual(["2026-05-22", "2026-05-25"]);
  });

  it("returns empty array for inverted range", () => {
    expect(expandToWorkingDays("2026-05-25", "2026-05-22", FULL_TIME)).toEqual([]);
  });
});
