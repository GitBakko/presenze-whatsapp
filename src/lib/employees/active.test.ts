import { describe, it, expect } from "vitest";
import { isActiveOn, activeOnWhere, activeInRangeWhere } from "./active";

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

describe("activeInRangeWhere", () => {
  it("builds hireDate<=rangeEnd AND terminationDate>=rangeStart", () => {
    expect(activeInRangeWhere("2026-06-01", "2026-06-30")).toEqual({
      AND: [
        { OR: [{ hireDate: null }, { hireDate: { lte: new Date("2026-06-30T23:59:59.999Z") } }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gte: new Date("2026-06-01T00:00:00.000Z") } }] },
      ],
    });
  });

  // Evaluate the declarative where against sample employees to prove the
  // range-OVERLAP semantics (active on ANY day in the period).
  function matchesRange(
    emp: { hireDate: Date | null; terminationDate: Date | null },
    fromIso: string,
    toIso: string,
  ): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [hireGroup, termGroup] = (activeInRangeWhere(fromIso, toIso) as any).AND;
    const hireOk = emp.hireDate === null || emp.hireDate <= hireGroup.OR[1].hireDate.lte;
    const termOk = emp.terminationDate === null || emp.terminationDate >= termGroup.OR[1].terminationDate.gte;
    return hireOk && termOk;
  }

  it("includes a mid-month leaver (the bug fix): terminated 2026-06-15 still in June", () => {
    expect(matchesRange({ hireDate: d("2024-01-01"), terminationDate: d("2026-06-15") }, "2026-06-01", "2026-06-30")).toBe(true);
  });
  it("includes a mid-month hire: hired 2026-06-20 still in June", () => {
    expect(matchesRange({ hireDate: d("2026-06-20"), terminationDate: null }, "2026-06-01", "2026-06-30")).toBe(true);
  });
  it("excludes an employee terminated before the month start", () => {
    expect(matchesRange({ hireDate: d("2024-01-01"), terminationDate: d("2026-05-31") }, "2026-06-01", "2026-06-30")).toBe(false);
  });
  it("excludes an employee hired after the month end", () => {
    expect(matchesRange({ hireDate: d("2026-07-01"), terminationDate: null }, "2026-06-01", "2026-06-30")).toBe(false);
  });
});
