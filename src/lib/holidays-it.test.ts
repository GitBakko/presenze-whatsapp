import { describe, it, expect } from "vitest";
import {
  getItalianHolidays,
  getItalianHolidaysNamed,
  isNonWorkingDay,
  getNonWorkingDayLabel,
} from "./holidays-it";

describe("getItalianHolidays", () => {
  it("returns 12 holidays per year (10 fixed + Pasqua + Pasquetta)", () => {
    for (const year of [2024, 2025, 2026]) {
      expect(getItalianHolidays(year).size).toBe(12);
    }
  });

  it("includes fixed holidays", () => {
    const h = getItalianHolidays(2025);
    expect(h.has("2025-01-01")).toBe(true); // Capodanno
    expect(h.has("2025-01-06")).toBe(true); // Epifania
    expect(h.has("2025-04-25")).toBe(true); // Liberazione
    expect(h.has("2025-05-01")).toBe(true); // Lavoro
    expect(h.has("2025-06-02")).toBe(true); // Repubblica
    expect(h.has("2025-08-15")).toBe(true); // Ferragosto
    expect(h.has("2025-11-01")).toBe(true); // Tutti i Santi
    expect(h.has("2025-12-08")).toBe(true); // Immacolata
    expect(h.has("2025-12-25")).toBe(true); // Natale
    expect(h.has("2025-12-26")).toBe(true); // Santo Stefano
  });

  it("computes Easter correctly for known years", () => {
    // Known Easter dates
    const knownEasters: Record<number, string> = {
      2024: "2024-03-31",
      2025: "2025-04-20",
      2026: "2026-04-05",
      2027: "2027-03-28",
    };
    for (const [year, easterDate] of Object.entries(knownEasters)) {
      const h = getItalianHolidays(Number(year));
      expect(h.has(easterDate)).toBe(true);
    }
  });

  it("includes Pasquetta (Monday after Easter)", () => {
    // 2025: Easter = April 20 (Sunday) → Pasquetta = April 21
    const h = getItalianHolidays(2025);
    expect(h.has("2025-04-21")).toBe(true);
  });
});

describe("getItalianHolidaysNamed", () => {
  it("returns name for each holiday", () => {
    const named = getItalianHolidaysNamed(2025);
    expect(named.get("2025-01-01")).toBe("Capodanno");
    expect(named.get("2025-04-20")).toBe("Pasqua");
    expect(named.get("2025-04-21")).toBe("Lunedì dell'Angelo");
    expect(named.get("2025-12-25")).toBe("Natale");
  });
});

describe("isNonWorkingDay", () => {
  it("returns true for Saturday", () => {
    expect(isNonWorkingDay("2025-04-12")).toBe(true); // Saturday
  });

  it("returns true for Sunday", () => {
    expect(isNonWorkingDay("2025-04-13")).toBe(true); // Sunday
  });

  it("returns true for a holiday on a weekday", () => {
    expect(isNonWorkingDay("2025-04-25")).toBe(true); // Liberazione, Friday
  });

  it("returns false for a regular weekday", () => {
    expect(isNonWorkingDay("2025-04-14")).toBe(false); // Monday
  });
});

describe("getNonWorkingDayLabel", () => {
  it("returns 'Sabato' for Saturday", () => {
    expect(getNonWorkingDayLabel("2025-04-12")).toBe("Sabato");
  });

  it("returns 'Domenica' for Sunday", () => {
    expect(getNonWorkingDayLabel("2025-04-13")).toBe("Domenica");
  });

  it("returns holiday name for a holiday", () => {
    expect(getNonWorkingDayLabel("2025-04-25")).toBe("Festa della Liberazione");
  });

  it("returns null for a regular weekday", () => {
    expect(getNonWorkingDayLabel("2025-04-14")).toBeNull();
  });
});
