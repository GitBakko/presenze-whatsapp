import { describe, it, expect } from "vitest";
import { isActiveOn, activeOnWhere } from "./active";

// Dates are stored at UTC midnight (new Date("YYYY-MM-DD")), same as hireDate.
const d = (iso: string) => new Date(iso);

describe("isActiveOn", () => {
  it("no hireDate, no terminationDate → always active", () => {
    expect(isActiveOn({ hireDate: null, terminationDate: null }, "2026-06-09")).toBe(true);
  });

  it("hired exactly on D → active (hire floor inclusive)", () => {
    expect(isActiveOn({ hireDate: d("2026-06-09"), terminationDate: null }, "2026-06-09")).toBe(true);
  });

  it("hired after D → inactive", () => {
    expect(isActiveOn({ hireDate: d("2026-06-10"), terminationDate: null }, "2026-06-09")).toBe(false);
  });

  it("hired before D → active", () => {
    expect(isActiveOn({ hireDate: d("2020-01-01"), terminationDate: null }, "2026-06-09")).toBe(true);
  });

  it("terminated exactly on D → active (termination ceiling inclusive)", () => {
    expect(isActiveOn({ hireDate: null, terminationDate: d("2026-06-09") }, "2026-06-09")).toBe(true);
  });

  it("terminated before D → inactive", () => {
    expect(isActiveOn({ hireDate: null, terminationDate: d("2026-06-08") }, "2026-06-09")).toBe(false);
  });

  it("terminated after D → active (history regression: a June leaver is active in May)", () => {
    expect(isActiveOn({ hireDate: null, terminationDate: d("2026-06-30") }, "2026-05-15")).toBe(true);
  });

  it("hired before D and terminated after D → active", () => {
    expect(isActiveOn({ hireDate: d("2024-01-01"), terminationDate: d("2026-12-31") }, "2026-06-09")).toBe(true);
  });

  it("D before hire AND after termination is impossible; D inside [hire, term] is active", () => {
    const emp = { hireDate: d("2026-06-01"), terminationDate: d("2026-06-30") };
    expect(isActiveOn(emp, "2026-05-31")).toBe(false); // before hire
    expect(isActiveOn(emp, "2026-07-01")).toBe(false); // after termination
    expect(isActiveOn(emp, "2026-06-15")).toBe(true);  // inside window
  });
});

describe("activeOnWhere", () => {
  it("builds an AND of two OR groups around the date", () => {
    const w = activeOnWhere("2026-06-09");
    expect(w).toEqual({
      AND: [
        { OR: [{ hireDate: null }, { hireDate: { lte: new Date("2026-06-09T23:59:59.999Z") } }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gte: new Date("2026-06-09T00:00:00.000Z") } }] },
      ],
    });
  });
});
