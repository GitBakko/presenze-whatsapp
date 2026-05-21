import { describe, it, expect } from "vitest";
import { classifyOverlap, type ExistingLeaveConflict } from "../overlap";

function makeConflict(partial: Partial<ExistingLeaveConflict>): ExistingLeaveConflict {
  return {
    id: "x",
    type: "VACATION",
    status: "APPROVED",
    startDate: "2026-05-22",
    endDate: "2026-05-22",
    hours: null,
    timeSlots: null,
    overlappingDays: ["2026-05-22"],
    ...partial,
  };
}

describe("classifyOverlap", () => {
  it("BLOCK on VACATION + VACATION same day", () => {
    const r = classifyOverlap(
      { type: "VACATION", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "VACATION" })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("OK on VACATION_HALF_AM + VACATION_HALF_PM same day", () => {
    const r = classifyOverlap(
      { type: "VACATION_HALF_AM", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "VACATION_HALF_PM" })]
    );
    expect(r.kind).toBe("OK");
  });

  it("BLOCK on VACATION (full) + ROL same day", () => {
    const r = classifyOverlap(
      { type: "ROL", startDate: "2026-05-22", endDate: "2026-05-22", hours: 3 },
      [makeConflict({ type: "VACATION" })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("OK on VACATION_HALF_AM + ROL in afternoon", () => {
    const r = classifyOverlap(
      { type: "ROL", startDate: "2026-05-22", endDate: "2026-05-22", timeSlots: '[{"from":"14:30","to":"16:30"}]' },
      [makeConflict({ type: "VACATION_HALF_AM" })]
    );
    expect(r.kind).toBe("OK");
  });

  it("REQUIRES_CONFIRM on SICK over existing VACATION APPROVED", () => {
    const r = classifyOverlap(
      { type: "SICK", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "VACATION" })]
    );
    expect(r.kind).toBe("REQUIRES_CONFIRM");
  });

  it("BLOCK on SICK + SICK same day", () => {
    const r = classifyOverlap(
      { type: "SICK", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "SICK" })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("BLOCK on VACATION over existing SICK", () => {
    const r = classifyOverlap(
      { type: "VACATION", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "SICK" })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("BLOCK on any over BEREAVEMENT/MARRIAGE/LAW_104/MEDICAL_VISIT", () => {
    for (const oneOff of ["BEREAVEMENT", "MARRIAGE", "LAW_104", "MEDICAL_VISIT"]) {
      const r = classifyOverlap(
        { type: "VACATION", startDate: "2026-05-22", endDate: "2026-05-22" },
        [makeConflict({ type: oneOff })]
      );
      expect(r.kind).toBe("BLOCK");
    }
  });

  it("ROL + ROL: BLOCK on overlapping timeSlots", () => {
    const r = classifyOverlap(
      { type: "ROL", startDate: "2026-05-22", endDate: "2026-05-22", timeSlots: '[{"from":"09:00","to":"11:00"}]' },
      [makeConflict({ type: "ROL", timeSlots: '[{"from":"10:00","to":"12:00"}]' })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("ROL + ROL: OK on disjoint timeSlots", () => {
    const r = classifyOverlap(
      { type: "ROL", startDate: "2026-05-22", endDate: "2026-05-22", timeSlots: '[{"from":"09:00","to":"10:00"}]' },
      [makeConflict({ type: "ROL", timeSlots: '[{"from":"15:00","to":"16:00"}]' })]
    );
    expect(r.kind).toBe("OK");
  });

  it("returns OK when no conflicts provided", () => {
    const r = classifyOverlap(
      { type: "VACATION", startDate: "2026-05-22", endDate: "2026-05-22" },
      []
    );
    expect(r.kind).toBe("OK");
  });
});
