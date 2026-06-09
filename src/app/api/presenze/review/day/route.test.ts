import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks for the route's collaborators (kept inert) ---------------------
vi.mock("@/lib/auth-guard", () => ({ checkAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }) }));
vi.mock("@/lib/notifications-bus", () => ({ notificationsBus: { publish: vi.fn() } }));
vi.mock("@/lib/attendance/recompute", () => ({
  recomputeAnomaliesForDates: vi.fn().mockResolvedValue(undefined),
}));

// --- Fake prisma that enforces @@unique([employeeId,date,type,declaredTime])
// PER STATEMENT (mirroring SQLite — NOT deferred). This is what makes a
// naive sequential update<->update swap blow up. Built inside vi.hoisted so
// the value exists when the hoisted vi.mock factory runs. -----------------
const h = vi.hoisted(() => {
  type Row = {
    id: string;
    employeeId: string;
    date: string;
    type: string;
    declaredTime: string;
  };

  class UniqueConstraintError extends Error {
    constructor() {
      super(
        "Unique constraint failed on the fields: (`employeeId`,`date`,`type`,`declaredTime`)",
      );
    }
  }

  const key = (r: Row) => `${r.employeeId}|${r.date}|${r.type}|${r.declaredTime}`;

  const store: { rows: Row[] } = { rows: [] };

  const assertUnique = (rows: Row[]) => {
    const seen = new Set<string>();
    for (const r of rows) {
      const k = key(r);
      if (seen.has(k)) throw new UniqueConstraintError();
      seen.add(k);
    }
  };

  const tx = {
    attendanceRecord: {
      delete: async ({ where: { id } }: { where: { id: string } }) => {
        store.rows = store.rows.filter((r) => r.id !== id);
        assertUnique(store.rows);
      },
      update: async ({
        where: { id },
        data,
      }: {
        where: { id: string };
        data: { type: string; declaredTime: string };
      }) => {
        const row = store.rows.find((r) => r.id === id)!;
        row.type = data.type;
        row.declaredTime = data.declaredTime;
        // SQLite enforces UNIQUE per-statement, immediately.
        assertUnique(store.rows);
        return row;
      },
      create: async ({ data }: { data: Row }) => {
        const created: Row = {
          id: data.id ?? `gen-${store.rows.length + 1}`,
          employeeId: data.employeeId,
          date: data.date,
          type: data.type,
          declaredTime: data.declaredTime,
        };
        store.rows.push(created);
        assertUnique(store.rows);
        return created;
      },
    },
    attendanceRecordEdit: { create: async () => ({}) },
  };

  const prismaMock = {
    employee: {
      findUnique: async () => ({ id: "e1", name: "Rossi", displayName: "ROSSI" }),
    },
    attendanceRecord: {
      findMany: async () =>
        [...store.rows].sort((a, b) => a.declaredTime.localeCompare(b.declaredTime)),
    },
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      const snapshot = store.rows.map((r) => ({ ...r }));
      try {
        return await fn(tx);
      } catch (err) {
        store.rows = snapshot; // rollback like a real tx
        throw err;
      }
    },
  };

  return { store, prismaMock };
});

vi.mock("@/lib/db", () => ({ prisma: h.prismaMock }));

// Import AFTER mocks are registered.
import { PUT } from "./route";

function mkReq(body: unknown): import("next/server").NextRequest {
  return new Request("http://localhost/api/presenze/review/day", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

describe("PUT /api/presenze/review/day — record-swap (transient unique constraint)", () => {
  beforeEach(() => {
    h.store.rows = [
      { id: "r1", employeeId: "e1", date: "2026-05-04", type: "ENTRY", declaredTime: "09:00" },
      { id: "r3", employeeId: "e1", date: "2026-05-04", type: "ENTRY", declaredTime: "14:00" },
    ];
  });

  it("swaps two same-type records' times without a 409 (final set is unique)", async () => {
    // r1 09:00 -> 14:00 and r3 14:00 -> 09:00. Naive sequential update of r1
    // to 14:00 transiently collides with r3 still at 14:00.
    const res = await PUT(
      mkReq({
        employeeId: "e1",
        date: "2026-05-04",
        records: [
          { id: "r1", type: "ENTRY", declaredTime: "14:00" },
          { id: "r3", type: "ENTRY", declaredTime: "09:00" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.updated).toBe(2);

    const final = Object.fromEntries(h.store.rows.map((r) => [r.id, r.declaredTime]));
    expect(final).toEqual({ r1: "14:00", r3: "09:00" });
  });

  it("still rejects a genuine final-set collision with 409", async () => {
    const res = await PUT(
      mkReq({
        employeeId: "e1",
        date: "2026-05-04",
        records: [
          { id: "r1", type: "ENTRY", declaredTime: "14:00" },
          { id: "r3", type: "ENTRY", declaredTime: "14:00" },
        ],
      }),
    );
    expect(res.status).toBe(409);
  });
});
