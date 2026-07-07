import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => {
  const db = {
    leaveRequest: { findMany: vi.fn(), deleteMany: vi.fn() },
  };
  return { prisma: db };
});

import { checkOverlap, supersedePredictorLeaves } from "../overlap";
import { prisma } from "../../db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mock = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mock.leaveRequest.findMany.mockResolvedValue([]);
  mock.leaveRequest.deleteMany.mockResolvedValue({ count: 0 });
});

describe("checkOverlap vs predictor days", () => {
  it("excludes PREDICTOR rows from the conflict query (never blocks a human request)", async () => {
    const r = await checkOverlap("e1", {
      type: "VACATION",
      startDate: "2026-08-10",
      endDate: "2026-08-14",
    });
    expect(r.kind).toBe("OK");
    const where = mock.leaveRequest.findMany.mock.calls[0][0].where;
    expect(where.source).toEqual({ not: "PREDICTOR" });
  });

  it("still blocks on a human VACATION conflict", async () => {
    mock.leaveRequest.findMany.mockResolvedValue([
      {
        id: "h1", type: "VACATION", status: "APPROVED", source: "MANAGER",
        startDate: "2026-08-12", endDate: "2026-08-12", hours: null, timeSlots: null,
      },
    ]);
    const r = await checkOverlap("e1", {
      type: "VACATION",
      startDate: "2026-08-10",
      endDate: "2026-08-14",
    });
    expect(r.kind).toBe("BLOCK");
  });
});

describe("supersedePredictorLeaves", () => {
  it("deletes only PREDICTOR leaves intersecting the requested range", async () => {
    mock.leaveRequest.deleteMany.mockResolvedValue({ count: 3 });
    const n = await supersedePredictorLeaves("e1", "2026-08-10", "2026-08-14");
    expect(n).toBe(3);
    expect(mock.leaveRequest.deleteMany).toHaveBeenCalledWith({
      where: {
        employeeId: "e1",
        source: "PREDICTOR",
        startDate: { lte: "2026-08-14" },
        endDate: { gte: "2026-08-10" },
      },
    });
  });

  it("excludes the edited leave itself via excludeId", async () => {
    await supersedePredictorLeaves("e1", "2026-08-10", "2026-08-14", { excludeId: "self" });
    const where = mock.leaveRequest.deleteMany.mock.calls[0][0].where;
    expect(where.NOT).toEqual({ id: "self" });
  });

  it("uses the provided transaction client when given", async () => {
    const tx = { leaveRequest: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const n = await supersedePredictorLeaves("e1", "2026-08-10", "2026-08-10", { db: tx });
    expect(n).toBe(1);
    expect(tx.leaveRequest.deleteMany).toHaveBeenCalled();
    expect(mock.leaveRequest.deleteMany).not.toHaveBeenCalled();
  });
});
