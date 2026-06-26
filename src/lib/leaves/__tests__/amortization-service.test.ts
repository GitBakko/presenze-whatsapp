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

/** N future weekday (Mon-Fri) YYYY-MM-DD dates within the given year, from tomorrow. */
function futureWeekdays(year: number, n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  while (out.length < n) {
    d.setDate(d.getDate() + 1);
    if (d.getFullYear() !== year) break;
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
  }
  return out;
}

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

  it("every predictor row is a whole VACATION day (no hourly ROL permits)", async () => {
    await recomputeAmortization(new Date().getFullYear(), "MANUAL", "user1");
    const rows = mock.leaveRequest.createMany.mock.calls[0][0].data;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.type).toBe("VACATION");
      expect(row.hours).toBe(null);
    }
  });

  it("excludes unconfirmed-future predictor leaves from the residual (idempotent re-run)", async () => {
    const YEAR = new Date().getFullYear();
    // First run: no pre-existing leaves → baseline plan size.
    mock.leaveRequest.findMany.mockResolvedValueOnce([]);
    await recomputeAmortization(YEAR, "MANUAL", "user1");
    const baseCount = mock.leaveRequest.createMany.mock.calls[0][0].data.length;
    expect(baseCount).toBeGreaterThan(0);

    // Second run: the employee now already carries the previous run's unconfirmed
    // future predictor days. They must be wiped+ignored, so the plan size is
    // identical — not collapsed to ~0 by double-counting them as "used".
    const existing = futureWeekdays(YEAR, 8).map((d) => ({
      type: "VACATION", startDate: d, endDate: d, hours: null, timeSlots: null,
      source: "PREDICTOR", confirmedAt: null,
    }));
    mock.leaveRequest.findMany.mockResolvedValueOnce(existing);
    await recomputeAmortization(YEAR, "MANUAL", "user1");
    const reCount = mock.leaveRequest.createMany.mock.calls[1][0].data.length;
    expect(reCount).toBe(baseCount);
  });

  it("no enabled employees → no wipe/create, writes an empty run", async () => {
    mock.employee.findMany.mockResolvedValue([]); // simulates the leavePredictorEnabled=true filter excluding everyone
    const res = await recomputeAmortization(new Date().getFullYear(), "MANUAL", "user1");
    expect(mock.leaveRequest.createMany).not.toHaveBeenCalled();
    expect(mock.leavePredictorRun.create).toHaveBeenCalled();
    expect(res.created).toBe(0);
  });
});
