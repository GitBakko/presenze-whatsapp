import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => {
  const db = {
    leaveRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    leaveRequestEdit: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { prisma: db };
});

import {
  shiftIsoDate,
  subtractDayFromRange,
  applyDayLeaveOp,
  DayLeaveError,
} from "../day-edit";
import { prisma } from "../../db";

const mockPrisma = prisma as unknown as {
  leaveRequest: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  leaveRequestEdit: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const baseLeave = {
  id: "lr_1",
  employeeId: "emp_1",
  type: "VACATION",
  startDate: "2026-06-03",
  endDate: "2026-06-07",
  hours: null,
  timeSlots: null,
  sickProtocol: null,
  notes: null,
  status: "APPROVED",
  source: "MANAGER",
  approvedById: "user_1",
  approvedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.leaveRequest.create.mockResolvedValue({ ...baseLeave, id: "lr_new" });
  mockPrisma.leaveRequest.update.mockResolvedValue(baseLeave);
  mockPrisma.leaveRequest.delete.mockResolvedValue(baseLeave);
  mockPrisma.leaveRequestEdit.create.mockResolvedValue({ id: "edit_1" });
});

describe("shiftIsoDate", () => {
  it("shifts within a month", () => {
    expect(shiftIsoDate("2026-06-05", -1)).toBe("2026-06-04");
    expect(shiftIsoDate("2026-06-05", 1)).toBe("2026-06-06");
  });
  it("crosses month boundary", () => {
    expect(shiftIsoDate("2026-06-01", -1)).toBe("2026-05-31");
    expect(shiftIsoDate("2026-06-30", 1)).toBe("2026-07-01");
  });
  it("crosses year boundary", () => {
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("subtractDayFromRange", () => {
  it("single-day == day → fully removed", () => {
    expect(subtractDayFromRange("2026-06-05", "2026-06-05", "2026-06-05")).toEqual([]);
  });
  it("day at start → shrink start", () => {
    expect(subtractDayFromRange("2026-06-03", "2026-06-07", "2026-06-03")).toEqual([
      { start: "2026-06-04", end: "2026-06-07" },
    ]);
  });
  it("day at end → shrink end", () => {
    expect(subtractDayFromRange("2026-06-03", "2026-06-07", "2026-06-07")).toEqual([
      { start: "2026-06-03", end: "2026-06-06" },
    ]);
  });
  it("day in the middle → split into two", () => {
    expect(subtractDayFromRange("2026-06-03", "2026-06-07", "2026-06-05")).toEqual([
      { start: "2026-06-03", end: "2026-06-04" },
      { start: "2026-06-06", end: "2026-06-07" },
    ]);
  });
  it("day outside range → unchanged (defensive)", () => {
    expect(subtractDayFromRange("2026-06-03", "2026-06-07", "2026-06-10")).toEqual([
      { start: "2026-06-03", end: "2026-06-07" },
    ]);
  });
});

describe("applyDayLeaveOp", () => {
  it("removeDay on a single-day leave deletes it", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      ...baseLeave, startDate: "2026-06-05", endDate: "2026-06-05",
    });
    const r = await applyDayLeaveOp({
      op: "removeDay", employeeId: "emp_1", date: "2026-06-05", leaveId: "lr_1", editorUserId: "user_1",
    });
    expect(mockPrisma.leaveRequest.delete).toHaveBeenCalledWith({ where: { id: "lr_1" } });
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(r.deletedLeaveId).toBe("lr_1");
  });

  it("removeDay at the start of a multi-day leave shrinks it (no split, no create)", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(baseLeave);
    const r = await applyDayLeaveOp({
      op: "removeDay", employeeId: "emp_1", date: "2026-06-03", leaveId: "lr_1", editorUserId: "user_1",
    });
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: "lr_1" },
      data: { startDate: "2026-06-04", endDate: "2026-06-07", version: { increment: 1 } },
    });
    expect(mockPrisma.leaveRequest.create).not.toHaveBeenCalled();
    expect(r.detachedFrom).toBe("lr_1");
    expect(r.splitTailId).toBeUndefined();
  });

  it("removeDay in the middle splits into a shrunk original + a new tail", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(baseLeave);
    mockPrisma.leaveRequest.create.mockResolvedValue({
      ...baseLeave, id: "lr_tail", startDate: "2026-06-06", endDate: "2026-06-07",
    });
    const r = await applyDayLeaveOp({
      op: "removeDay", employeeId: "emp_1", date: "2026-06-05", leaveId: "lr_1", editorUserId: "user_1",
    });
    expect(mockPrisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: "lr_1" },
      data: { startDate: "2026-06-03", endDate: "2026-06-04", version: { increment: 1 } },
    });
    expect(mockPrisma.leaveRequest.create).toHaveBeenCalledTimes(1);
    const tailArg = mockPrisma.leaveRequest.create.mock.calls[0][0].data;
    expect(tailArg.startDate).toBe("2026-06-06");
    expect(tailArg.endDate).toBe("2026-06-07");
    expect(tailArg.type).toBe("VACATION");
    expect(r.splitTailId).toBe("lr_tail");
  });

  it("editDay detaches the day then creates a single-day leave with the new type/hours", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({
      ...baseLeave, startDate: "2026-06-05", endDate: "2026-06-05", type: "ROL", hours: 4,
    });
    mockPrisma.leaveRequest.create.mockResolvedValue({ ...baseLeave, id: "lr_new", type: "ROL", hours: 2 });
    const r = await applyDayLeaveOp({
      op: "editDay", employeeId: "emp_1", date: "2026-06-05", leaveId: "lr_1",
      type: "ROL", hours: 2, editorUserId: "user_1",
    });
    // single-day → delete then create
    expect(mockPrisma.leaveRequest.delete).toHaveBeenCalledWith({ where: { id: "lr_1" } });
    const createArg = mockPrisma.leaveRequest.create.mock.calls[0][0].data;
    expect(createArg).toMatchObject({
      employeeId: "emp_1", type: "ROL", startDate: "2026-06-05", endDate: "2026-06-05", hours: 2, status: "APPROVED",
    });
    expect(r.createdLeaveId).toBe("lr_new");
  });

  it("add creates a single-day leave without touching others", async () => {
    const r = await applyDayLeaveOp({
      op: "add", employeeId: "emp_1", date: "2026-06-05", type: "ROL", hours: 3, editorUserId: "user_1",
    });
    expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequest.delete).not.toHaveBeenCalled();
    const createArg = mockPrisma.leaveRequest.create.mock.calls[0][0].data;
    expect(createArg).toMatchObject({
      type: "ROL", startDate: "2026-06-05", endDate: "2026-06-05", hours: 3,
    });
    expect(r.createdLeaveId).toBeDefined();
  });

  it("rejects a day outside the leave range", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(baseLeave);
    await expect(applyDayLeaveOp({
      op: "removeDay", employeeId: "emp_1", date: "2026-06-20", leaveId: "lr_1", editorUserId: "user_1",
    })).rejects.toThrow(DayLeaveError);
  });

  it("rejects editing a REJECTED leave", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...baseLeave, status: "REJECTED" });
    await expect(applyDayLeaveOp({
      op: "removeDay", employeeId: "emp_1", date: "2026-06-05", leaveId: "lr_1", editorUserId: "user_1",
    })).rejects.toThrow("EDIT_NOT_ALLOWED_REJECTED");
  });

  it("rejects an employee mismatch", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...baseLeave, employeeId: "emp_OTHER" });
    await expect(applyDayLeaveOp({
      op: "removeDay", employeeId: "emp_1", date: "2026-06-05", leaveId: "lr_1", editorUserId: "user_1",
    })).rejects.toThrow("BAD_REQUEST");
  });
});
