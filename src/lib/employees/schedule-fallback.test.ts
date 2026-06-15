import { describe, it, expect } from "vitest";
import {
  appliesScheduleFallback,
  effectiveScheduledHours,
  FALLBACK_WORKING_DOWS,
} from "./schedule-fallback";

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
