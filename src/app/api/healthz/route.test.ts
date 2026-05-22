import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth-guard", () => ({
  checkAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { _resetForTest, recordRunning, recordTick, recordWsListening } from "@/lib/worker-metrics";

describe("GET /api/healthz", () => {
  beforeEach(async () => {
    vi.mocked(checkAuth).mockReset();
    vi.mocked(prisma.$queryRaw).mockReset();
    _resetForTest();
  });

  it("returns 401 when checkAuth rejects with 401", async () => {
    vi.mocked(checkAuth).mockResolvedValue(
      Response.json({ error: "Non autorizzato" }, { status: 401 })
    );
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 200 ok payload when DB ping + workers all healthy", async () => {
    vi.mocked(checkAuth).mockResolvedValue(null);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ ok: 1 }]);
    recordRunning("mail-ingest", true);
    recordTick("mail-ingest", { ok: true, durationMs: 50 });
    recordRunning("monthly-report", true);
    recordTick("monthly-report", { ok: true, durationMs: 5 });
    recordWsListening(true);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db.ok).toBe(true);
    expect(body.workers["mail-ingest"]).toBeDefined();
    expect(typeof body.uptimeSec).toBe("number");
    expect(typeof body.version).toBe("string");
  });

  it("returns 503 down when DB ping fails", async () => {
    vi.mocked(checkAuth).mockResolvedValue(null);
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("db gone"));
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("down");
    expect(body.db.ok).toBe(false);
  });

  it("returns degraded when ws-notifications not listening", async () => {
    vi.mocked(checkAuth).mockResolvedValue(null);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ ok: 1 }]);
    recordRunning("mail-ingest", true);
    recordTick("mail-ingest", { ok: true });
    recordWsListening(false);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("degraded");
  });

  it("returns degraded when a worker has lastErrorAt newer than lastSuccessAt", async () => {
    vi.mocked(checkAuth).mockResolvedValue(null);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ ok: 1 }]);
    recordRunning("mail-ingest", true);
    recordTick("mail-ingest", { ok: true });
    await new Promise((r) => setTimeout(r, 10));
    recordTick("mail-ingest", { ok: false, errorMessage: "graph 503" });
    recordWsListening(true);

    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("degraded");
  });
});
