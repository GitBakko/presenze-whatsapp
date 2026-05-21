import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => {
  const db = {
    leaveRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    leaveRequestEdit: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { prisma: db };
});

import { editLeaveRequest } from "../edit-service";
import { prisma } from "../../db";

const mockPrisma = prisma as unknown as {
  leaveRequest: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  leaveRequestEdit: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const baseLeave = {
  id: "lr_1",
  employeeId: "emp_1",
  type: "VACATION",
  startDate: "2026-05-22",
  endDate: "2026-05-23",
  hours: null,
  timeSlots: null,
  sickProtocol: null,
  notes: null,
  status: "APPROVED",
  version: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("editLeaveRequest", () => {
  it("throws EDIT_NOT_ALLOWED_REJECTED for REJECTED leaves", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...baseLeave, status: "REJECTED" });
    await expect(editLeaveRequest("lr_1", "user_1", { version: 0, startDate: "2026-05-25" }))
      .rejects.toThrow("EDIT_NOT_ALLOWED_REJECTED");
  });

  it("throws STALE_STATE when version mismatch", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...baseLeave, version: 5 });
    await expect(editLeaveRequest("lr_1", "user_1", { version: 0, startDate: "2026-05-25" }))
      .rejects.toThrow("STALE_STATE");
  });

  it("returns idempotent result when no fields change", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(baseLeave);
    const r = await editLeaveRequest("lr_1", "user_1", { version: 0 });
    expect(r.changedFields).toEqual([]);
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequestEdit.create).not.toHaveBeenCalled();
  });
});
