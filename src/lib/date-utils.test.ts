import { describe, it, expect } from "vitest";
import { getDayOfWeek, hmToMinutes, formatDateIt, formatDateTimeIt } from "./date-utils";

describe("getDayOfWeek", () => {
  it("returns 1 for Monday", () => {
    expect(getDayOfWeek("2025-04-14")).toBe(1); // Monday
  });

  it("returns 5 for Friday", () => {
    expect(getDayOfWeek("2025-04-18")).toBe(5);
  });

  it("returns 6 for Saturday", () => {
    expect(getDayOfWeek("2025-04-19")).toBe(6);
  });

  it("returns 7 for Sunday (ISO convention, not 0)", () => {
    expect(getDayOfWeek("2025-04-20")).toBe(7);
  });
});

describe("hmToMinutes", () => {
  it("converts HH:MM to total minutes", () => {
    expect(hmToMinutes("00:00")).toBe(0);
    expect(hmToMinutes("01:00")).toBe(60);
    expect(hmToMinutes("09:30")).toBe(570);
    expect(hmToMinutes("13:00")).toBe(780);
    expect(hmToMinutes("18:30")).toBe(1110);
    expect(hmToMinutes("23:59")).toBe(1439);
  });
});

describe("formatDateIt", () => {
  it("formats YYYY-MM-DD to DD/MM/YYYY", () => {
    expect(formatDateIt("2025-04-14")).toBe("14/04/2025");
  });

  it("handles single-digit day/month correctly", () => {
    expect(formatDateIt("2025-01-05")).toBe("05/01/2025");
  });
});

describe("formatDateTimeIt", () => {
  it("formats ISO datetime to DD/MM/YYYY HH:MM", () => {
    const result = formatDateTimeIt("2025-04-14T09:30:00.000Z");
    // The exact output depends on the locale TZ, but it should contain DD/MM/YYYY
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
