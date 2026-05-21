import { describe, it, expect } from "vitest";
import { computeDiff, formatDiffForNotification } from "../audit";

const baseLeave = {
  id: "lr_1",
  employeeId: "emp_1",
  type: "VACATION",
  startDate: "2026-05-22",
  endDate: "2026-05-23",
  hours: null as number | null,
  timeSlots: null as string | null,
  sickProtocol: null as string | null,
  notes: null as string | null,
  status: "APPROVED",
};

describe("computeDiff", () => {
  it("returns empty changedFields when nothing changed", () => {
    const d = computeDiff(baseLeave, { ...baseLeave });
    expect(d.changedFields).toEqual([]);
  });

  it("captures startDate change only", () => {
    const next = { ...baseLeave, startDate: "2026-05-25", endDate: "2026-05-26" };
    const d = computeDiff(baseLeave, next);
    expect(d.changedFields.sort()).toEqual(["endDate", "startDate"]);
    expect(d.changes.startDate).toEqual({ old: "2026-05-22", new: "2026-05-25" });
  });

  it("captures type change", () => {
    const next = { ...baseLeave, type: "ROL", hours: 3 };
    const d = computeDiff(baseLeave, next);
    expect(d.changedFields).toContain("type");
    expect(d.changedFields).toContain("hours");
  });

  it("ignores fields outside the watched list", () => {
    const d = computeDiff({ ...baseLeave, employeeId: "emp_1" }, { ...baseLeave, employeeId: "emp_2" });
    expect(d.changedFields).toEqual([]);
  });
});

describe("formatDiffForNotification", () => {
  it("produces an Italian body summarizing changes", () => {
    const diff = computeDiff(baseLeave, { ...baseLeave, startDate: "2026-05-25", endDate: "2026-05-26" });
    const out = formatDiffForNotification(diff, "it");
    expect(out.subject).toMatch(/modificata/i);
    expect(out.body).toMatch(/22\/05\/2026.*25\/05\/2026/);
    expect(out.telegramBody.length).toBeGreaterThan(0);
  });

  it("includes only changed lines", () => {
    const diff = computeDiff(baseLeave, { ...baseLeave, notes: "nuova nota" });
    const out = formatDiffForNotification(diff, "it");
    expect(out.body).toMatch(/Note/);
    expect(out.body).not.toMatch(/Periodo/);
  });
});
