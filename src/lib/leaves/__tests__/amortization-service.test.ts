import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => {
  const db = {
    employee: { findMany: vi.fn() },
    leaveBalance: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    leavePredictorRun: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { prisma: db };
});

import { recomputeAmortization } from "../amortization-service";
import { prisma } from "../../db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mock = prisma as unknown as Record<string, any>;

function enabledEmployee() {
  return {
    id: "e1",
    contractType: "FULL_TIME",
    terminationDate: null,
    hireDate: new Date("2020-01-01"),
    leavePredictorEnabled: true,
    schedule: [1, 2, 3, 4, 5].map((d) => ({
      dayOfWeek: d, block1Start: "09:00", block1End: "13:00", block2Start: "14:00", block2End: "18:00",
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.employee.findMany.mockResolvedValue([enabledEmployee()]);
  mock.leaveBalance.findMany.mockResolvedValue([]);
  mock.leaveRequest.findMany.mockResolvedValue([]);
  mock.leaveRequest.deleteMany.mockResolvedValue({ count: 0 });
  mock.leaveRequest.createMany.mockResolvedValue({ count: 0 });
  mock.leavePredictorRun.create.mockResolvedValue({ id: "run1" });
});

describe("recomputeAmortization", () => {
  it("wipes only unconfirmed future predictor leaves", async () => {
    await recomputeAmortization(new Date().getFullYear(), "MANUAL", "user1");
    expect(mock.leaveRequest.deleteMany).toHaveBeenCalled();
    const where = mock.leaveRequest.deleteMany.mock.calls[0][0].where;
    expect(where.source).toBe("PREDICTOR");
    expect(where.confirmedAt).toBe(null);
    expect(where.startDate.gt).toBeDefined();
  });

  it("creates predictor leaves with source=PREDICTOR status=APPROVED confirmedAt=null", async () => {
    await recomputeAmortization(new Date().getFullYear(), "MANUAL", "user1");
    expect(mock.leaveRequest.createMany).toHaveBeenCalled();
    const rows = mock.leaveRequest.createMany.mock.calls[0][0].data;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source).toBe("PREDICTOR");
      expect(row.status).toBe("APPROVED");
      expect(row.confirmedAt).toBe(null);
      expect(row.startDate).toBe(row.endDate); // single-day blocks
    }
    expect(mock.leavePredictorRun.create).toHaveBeenCalled();
  });

  it("ROL predictor rows carry hours = daily working hours; VACATION rows carry null", async () => {
    await recomputeAmortization(new Date().getFullYear(), "MANUAL", "user1");
    const rows = mock.leaveRequest.createMany.mock.calls[0][0].data;
    for (const row of rows) {
      if (row.type === "ROL") expect(row.hours).toBe(8);
      else expect(row.hours).toBe(null);
    }
  });

  it("no enabled employees → no wipe/create, writes an empty run", async () => {
    mock.employee.findMany.mockResolvedValue([]); // simulates the leavePredictorEnabled=true filter excluding everyone
    const res = await recomputeAmortization(new Date().getFullYear(), "MANUAL", "user1");
    expect(mock.leaveRequest.createMany).not.toHaveBeenCalled();
    expect(mock.leavePredictorRun.create).toHaveBeenCalled();
    expect(res.created).toBe(0);
  });
});
