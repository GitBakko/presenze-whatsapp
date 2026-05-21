import { describe, it, expect } from "vitest";
import { isLocalHoliday, isPublicHoliday } from "../holidays";

describe("isLocalHoliday", () => {
  it("returns true for San Feliciano 24/01 (any year)", () => {
    expect(isLocalHoliday("2026-01-24")).toBe(true);
    expect(isLocalHoliday("2027-01-24")).toBe(true);
    expect(isLocalHoliday("2030-01-24")).toBe(true);
  });

  it("returns false for non-local-holiday dates", () => {
    expect(isLocalHoliday("2026-01-23")).toBe(false);
    expect(isLocalHoliday("2026-01-25")).toBe(false);
    expect(isLocalHoliday("2026-12-25")).toBe(false);
  });
});

describe("isPublicHoliday", () => {
  it("returns true for Italian national holidays", () => {
    expect(isPublicHoliday("2026-01-01")).toBe(true);
    expect(isPublicHoliday("2026-04-25")).toBe(true);
    expect(isPublicHoliday("2026-05-01")).toBe(true);
    expect(isPublicHoliday("2026-08-15")).toBe(true);
    expect(isPublicHoliday("2026-12-25")).toBe(true);
    expect(isPublicHoliday("2026-12-26")).toBe(true);
  });

  it("returns true for San Feliciano (local)", () => {
    expect(isPublicHoliday("2027-01-24")).toBe(true);
  });

  it("returns true for Easter and Easter Monday (movable)", () => {
    expect(isPublicHoliday("2026-04-05")).toBe(true);
    expect(isPublicHoliday("2026-04-06")).toBe(true);
  });

  it("returns false for regular working days", () => {
    expect(isPublicHoliday("2026-05-21")).toBe(false);
    expect(isPublicHoliday("2026-03-15")).toBe(false);
  });
});
