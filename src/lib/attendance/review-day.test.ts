// src/lib/attendance/review-day.test.ts
import { describe, it, expect } from "vitest";
import { planDayBatch, type ExistingRecord, type SubmittedRecord } from "./review-day";

const existing: ExistingRecord[] = [
  { id: "r1", type: "ENTRY", declaredTime: "09:00" },
  { id: "r2", type: "EXIT", declaredTime: "13:00" },
  { id: "r3", type: "ENTRY", declaredTime: "14:00" },
];

describe("planDayBatch", () => {
  it("creates records with no id", () => {
    const submitted: SubmittedRecord[] = [{ type: "EXIT", declaredTime: "18:00" }];
    const plan = planDayBatch(existing, submitted);
    expect(plan.toCreate).toEqual([{ type: "EXIT", declaredTime: "18:00" }]);
  });

  it("updates a record whose declaredTime changed", () => {
    const submitted: SubmittedRecord[] = [
      { id: "r1", type: "ENTRY", declaredTime: "09:15" },
      { id: "r2", type: "EXIT", declaredTime: "13:00" },
      { id: "r3", type: "ENTRY", declaredTime: "14:00" },
    ];
    const plan = planDayBatch(existing, submitted);
    expect(plan.toUpdate).toEqual([{ id: "r1", type: "ENTRY", declaredTime: "09:15" }]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.toCreate).toEqual([]);
  });

  it("deletes records omitted from the submission", () => {
    const submitted: SubmittedRecord[] = [{ id: "r1", type: "ENTRY", declaredTime: "09:00" }];
    const plan = planDayBatch(existing, submitted);
    expect(plan.toDelete.sort()).toEqual(["r2", "r3"]);
  });

  it("no-ops an unchanged record (not in update)", () => {
    const submitted: SubmittedRecord[] = [
      { id: "r1", type: "ENTRY", declaredTime: "09:00" },
      { id: "r2", type: "EXIT", declaredTime: "13:00" },
      { id: "r3", type: "ENTRY", declaredTime: "14:00" },
    ];
    const plan = planDayBatch(existing, submitted);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });

  it("detects an intra-batch collision (two records same type+time)", () => {
    const submitted: SubmittedRecord[] = [
      { id: "r1", type: "ENTRY", declaredTime: "09:00" },
      { type: "ENTRY", declaredTime: "09:00" }, // duplicate of r1's identity
    ];
    const plan = planDayBatch(existing, submitted);
    expect(plan.collision).toBe(true);
  });

  it("no collision when final set has unique (type, declaredTime)", () => {
    const submitted: SubmittedRecord[] = [
      { id: "r1", type: "ENTRY", declaredTime: "09:00" },
      { type: "ENTRY", declaredTime: "09:30" },
    ];
    const plan = planDayBatch(existing, submitted);
    expect(plan.collision).toBe(false);
  });

  it("rejects a submitted id not present in existing (stale)", () => {
    const submitted: SubmittedRecord[] = [{ id: "ghost", type: "ENTRY", declaredTime: "09:00" }];
    const plan = planDayBatch(existing, submitted);
    expect(plan.unknownIds).toEqual(["ghost"]);
  });
});
