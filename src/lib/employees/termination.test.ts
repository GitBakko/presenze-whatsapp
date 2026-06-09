import { describe, it, expect } from "vitest";
import { planTermination, isTerminatedOnDate } from "./termination";

const baseEmp = {
  id: "e1",
  hireDate: new Date("2024-01-01"),
  nfcUid: "04A1B2C3",
  telegramChatId: "123456789",
};

describe("planTermination", () => {
  it("builds updateData nulling nfcUid + telegramChatId and setting the 4 fields", () => {
    const { updateData } = planTermination(
      baseEmp,
      { terminationDate: "2026-06-09", reason: "RESIGNATION" },
      "admin-1",
      new Date("2026-06-09T10:00:00Z"),
    );
    expect(updateData.nfcUid).toBeNull();
    expect(updateData.telegramChatId).toBeNull();
    expect(updateData.terminationDate).toEqual(new Date("2026-06-09"));
    expect(updateData.terminationReason).toBe("RESIGNATION");
    expect(updateData.terminatedById).toBe("admin-1");
    expect(updateData.terminatedAt).toEqual(new Date("2026-06-09T10:00:00Z"));
  });

  it("appends a free-text note to the reason when provided", () => {
    const { updateData } = planTermination(
      baseEmp,
      { terminationDate: "2026-06-09", reason: "OTHER", note: "trasferimento sede" },
      "admin-1",
      new Date("2026-06-09T10:00:00Z"),
    );
    expect(updateData.terminationReason).toBe("OTHER: trasferimento sede");
  });

  it("throws when terminationDate is before hireDate", () => {
    expect(() =>
      planTermination(
        baseEmp,
        { terminationDate: "2023-12-31", reason: "DISMISSAL" },
        "admin-1",
        new Date("2026-06-09T10:00:00Z"),
      ),
    ).toThrow(/hireDate|assunzione/i);
  });

  it("throws on malformed terminationDate", () => {
    expect(() =>
      planTermination(baseEmp, { terminationDate: "09/06/2026", reason: "OTHER" }, "admin-1", new Date()),
    ).toThrow(/YYYY-MM-DD|formato/i);
  });

  it("throws on invalid reason", () => {
    expect(() =>
      // @ts-expect-error invalid reason on purpose
      planTermination(baseEmp, { terminationDate: "2026-06-09", reason: "FIRED" }, "admin-1", new Date()),
    ).toThrow(/reason|motivo/i);
  });

  it("warns when approved/pending leaves exist beyond terminationDate", () => {
    const { warnings } = planTermination(
      baseEmp,
      { terminationDate: "2026-06-09", reason: "RESIGNATION" },
      "admin-1",
      new Date("2026-06-09T10:00:00Z"),
      [{ status: "APPROVED", startDate: "2026-06-20", endDate: "2026-06-22" }],
    );
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/2026-06-20/);
  });

  it("no warning when all leaves end on/before terminationDate", () => {
    const { warnings } = planTermination(
      baseEmp,
      { terminationDate: "2026-06-09", reason: "RESIGNATION" },
      "admin-1",
      new Date("2026-06-09T10:00:00Z"),
      [{ status: "APPROVED", startDate: "2026-06-01", endDate: "2026-06-05" }],
    );
    expect(warnings.length).toBe(0);
  });

  it("ignores hireDate check when employee has no hireDate", () => {
    const { updateData } = planTermination(
      { id: "e2", hireDate: null, nfcUid: null, telegramChatId: null },
      { terminationDate: "2026-06-09", reason: "OTHER" },
      "admin-1",
      new Date("2026-06-09T10:00:00Z"),
    );
    expect(updateData.terminationDate).toEqual(new Date("2026-06-09"));
  });
});

describe("isTerminatedOnDate", () => {
  it("null termDate → never terminated", () => {
    expect(isTerminatedOnDate(null, "2026-06-09")).toBe(false);
  });
  it("date after termination → terminated", () => {
    expect(isTerminatedOnDate(new Date("2026-06-09"), "2026-06-10")).toBe(true);
  });
  it("date equal to termination → NOT terminated (inclusive last day)", () => {
    expect(isTerminatedOnDate(new Date("2026-06-09"), "2026-06-09")).toBe(false);
  });
  it("date before termination → NOT terminated", () => {
    expect(isTerminatedOnDate(new Date("2026-06-09"), "2026-06-08")).toBe(false);
  });
});
