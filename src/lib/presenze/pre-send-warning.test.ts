// src/lib/presenze/pre-send-warning.test.ts
import { describe, it, expect } from "vitest";
import { shouldWarnPreSend } from "./pre-send-warning";

const base = { today: 3, reportDay: 5, warnLeadDays: 2, alreadySent: false, redIssueCount: 4 };

describe("shouldWarnPreSend", () => {
  it("warns inside the lead window with red issues", () => {
    expect(shouldWarnPreSend(base)).toBe(true); // 5 - 3 = 2 <= 2
  });

  it("does not warn outside the lead window (too early)", () => {
    expect(shouldWarnPreSend({ ...base, today: 1 })).toBe(false); // 5 - 1 = 4 > 2
  });

  it("does not warn on/after report day", () => {
    expect(shouldWarnPreSend({ ...base, today: 5 })).toBe(false);
    expect(shouldWarnPreSend({ ...base, today: 6 })).toBe(false);
  });

  it("does not warn when no red issues", () => {
    expect(shouldWarnPreSend({ ...base, redIssueCount: 0 })).toBe(false);
  });

  it("does not warn when already sent", () => {
    expect(shouldWarnPreSend({ ...base, alreadySent: true })).toBe(false);
  });

  it("warns exactly on the lead-window boundary", () => {
    expect(shouldWarnPreSend({ ...base, today: 4, warnLeadDays: 1 })).toBe(true); // 5 - 4 = 1 <= 1
  });
});
