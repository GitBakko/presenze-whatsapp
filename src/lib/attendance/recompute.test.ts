// src/lib/attendance/recompute.test.ts
import { describe, it, expect } from "vitest";
import { computeRecordDiff, WATCHED_RECORD_FIELDS } from "./recompute";

const base = { type: "ENTRY", declaredTime: "09:00", date: "2026-05-04" };

describe("WATCHED_RECORD_FIELDS", () => {
  it("watches exactly type, declaredTime, date", () => {
    expect([...WATCHED_RECORD_FIELDS].sort()).toEqual(["date", "declaredTime", "type"]);
  });
});

describe("computeRecordDiff", () => {
  it("empty changedFields when nothing changed", () => {
    expect(computeRecordDiff(base, { ...base }).changedFields).toEqual([]);
  });

  it("captures declaredTime change", () => {
    const d = computeRecordDiff(base, { ...base, declaredTime: "09:15" });
    expect(d.changedFields).toEqual(["declaredTime"]);
    expect(d.changes.declaredTime).toEqual({ old: "09:00", new: "09:15" });
  });

  it("captures type change", () => {
    const d = computeRecordDiff(base, { ...base, type: "EXIT" });
    expect(d.changedFields).toEqual(["type"]);
  });

  it("captures multiple changes (type + date)", () => {
    const d = computeRecordDiff(base, { ...base, type: "EXIT", date: "2026-05-05" });
    expect(d.changedFields.sort()).toEqual(["date", "type"]);
  });

  it("treats null and undefined as equal (no spurious change)", () => {
    const d = computeRecordDiff(
      { type: "ENTRY", declaredTime: "09:00", date: null },
      { type: "ENTRY", declaredTime: "09:00", date: undefined },
    );
    expect(d.changedFields).toEqual([]);
  });
});
