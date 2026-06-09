import { describe, it, expect } from "vitest";
import { shouldSuppressAnomaly } from "./anomaly-sync";

describe("shouldSuppressAnomaly", () => {
  it("no termination → never suppress", () => {
    expect(shouldSuppressAnomaly(null, "2026-06-09")).toBe(false);
  });
  it("date after termination → suppress (no anomaly for post-termination days)", () => {
    expect(shouldSuppressAnomaly(new Date("2026-06-09"), "2026-06-10")).toBe(true);
  });
  it("date equal to termination → do NOT suppress (inclusive last day)", () => {
    expect(shouldSuppressAnomaly(new Date("2026-06-09"), "2026-06-09")).toBe(false);
  });
  it("date before termination → do NOT suppress", () => {
    expect(shouldSuppressAnomaly(new Date("2026-06-09"), "2026-05-01")).toBe(false);
  });
});
