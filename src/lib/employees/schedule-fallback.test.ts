import { describe, it, expect } from "vitest";
import {
  appliesScheduleFallback,
  effectiveScheduledHours,
  FALLBACK_WORKING_DOWS,
  hasWorkBlock,
  buildWorkingScheduleMap,
} from "./schedule-fallback";

const NULL_BLOCKS = { block1Start: null, block1End: null, block2Start: null, block2End: null };
const MORNING = { block1Start: "09:00", block1End: "13:00", block2Start: null, block2End: null };

describe("schedule fallback (shared rule: preview-days = balance = presenze report)", () => {
  it("FULL_TIME with zero schedule rows uses the Mon-Fri fallback", () => {
    expect(appliesScheduleFallback(0, "FULL_TIME")).toBe(true);
  });

  it("any schedule row disables the fallback (trust the real schedule, even empty days)", () => {
    expect(appliesScheduleFallback(5, "FULL_TIME")).toBe(false);
    expect(appliesScheduleFallback(1, "FULL_TIME")).toBe(false);
  });

  it("PART_TIME with zero rows does NOT fall back (documented limitation, no such employee)", () => {
    expect(appliesScheduleFallback(0, "PART_TIME")).toBe(false);
  });

  it("FALLBACK_WORKING_DOWS is Mon-Fri (ISO 1..5)", () => {
    expect([...FALLBACK_WORKING_DOWS]).toEqual([1, 2, 3, 4, 5]);
  });

  it("effective hours: fallback yields contractual hours Mon-Fri, 0 on weekend", () => {
    // dowIso: 1=Mon .. 7=Sun
    expect(effectiveScheduledHours(0, true, 1, "FULL_TIME")).toBe(8);
    expect(effectiveScheduledHours(0, true, 5, "FULL_TIME")).toBe(8);
    expect(effectiveScheduledHours(0, true, 6, "FULL_TIME")).toBe(0);
    expect(effectiveScheduledHours(0, true, 7, "FULL_TIME")).toBe(0);
  });

  it("effective hours: without fallback returns the real per-day hours unchanged", () => {
    expect(effectiveScheduledHours(4, false, 6, "FULL_TIME")).toBe(4);
    expect(effectiveScheduledHours(0, false, 3, "FULL_TIME")).toBe(0);
    expect(effectiveScheduledHours(7.5, false, 2, "FULL_TIME")).toBe(7.5);
  });
});

describe("hasWorkBlock", () => {
  it("true when a complete block exists (morning or afternoon)", () => {
    expect(hasWorkBlock(MORNING)).toBe(true);
    expect(hasWorkBlock({ block1Start: null, block1End: null, block2Start: "14:00", block2End: "18:00" })).toBe(true);
  });
  it("false when all blocks are null, or a block is half-open", () => {
    expect(hasWorkBlock(NULL_BLOCKS)).toBe(false);
    expect(hasWorkBlock({ block1Start: "09:00", block1End: null, block2Start: null, block2End: null })).toBe(false);
  });
});

describe("buildWorkingScheduleMap", () => {
  it("keeps only rows with work hours; drops empty (all-null) rows", () => {
    const map = buildWorkingScheduleMap(
      [
        { dayOfWeek: 1, ...MORNING },
        { dayOfWeek: 6, ...NULL_BLOCKS }, // stray empty Saturday → excluded
        { dayOfWeek: 7, ...NULL_BLOCKS }, // stray empty Sunday → excluded
      ],
      "FULL_TIME",
    );
    expect(map.has(1)).toBe(true);
    expect(map.has(6)).toBe(false);
    expect(map.has(7)).toBe(false);
  });

  it("schedule-less FULL_TIME falls back to Mon-Fri", () => {
    const map = buildWorkingScheduleMap([], "FULL_TIME");
    expect([...map.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("does NOT fall back when at least one real row exists, even if others are empty", () => {
    const map = buildWorkingScheduleMap(
      [{ dayOfWeek: 3, ...MORNING }, { dayOfWeek: 4, ...NULL_BLOCKS }],
      "FULL_TIME",
    );
    expect([...map.keys()]).toEqual([3]); // only the real working day
  });
});
