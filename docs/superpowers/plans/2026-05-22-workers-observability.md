# Workers Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime observability (structured logger + in-memory metrics + admin `/api/healthz` endpoint + `/settings/system-health` page) on top of the three workers (mail-ingest, monthly-report, ws-notifications) so silent downtime stops being silent.

**Architecture:** Three layers — a thin JSON logger that writes to stdout (captured by NSSM), a singleton in-memory metrics registry the workers tick on every cycle, and an admin-only health endpoint that snapshots the registry plus a DB liveness ping. A dedicated client page polls the endpoint every 30s.

**Tech Stack:** TypeScript, Next.js 16 App Router, Vitest, Prisma 6 (SQLite), Tailwind. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-05-22-workers-observability-design.md`

---

## File Structure

**New files:**
| Path | Responsibility |
|------|----------------|
| `src/lib/logger.ts` | Thin JSON logger (`debug`/`info`/`warn`/`error`) with level filter |
| `src/lib/logger.test.ts` | Logger unit tests (level filter, shape, circular ref) |
| `src/lib/worker-metrics.ts` | Singleton registry: tick counters, ring buffer of durations, ws state |
| `src/lib/worker-metrics.test.ts` | Registry unit tests |
| `src/app/api/healthz/route.ts` | Admin GET endpoint, DB ping + snapshot |
| `src/app/api/healthz/route.test.ts` | Endpoint integration tests |
| `src/app/(dashboard)/settings/system-health/page.tsx` | Client page with auto-refresh |

**Modified files:**
| Path | Change |
|------|--------|
| `src/lib/mail-ingest.ts` | Replace 6 `console.*` with `logger.*`, add `recordTick`/`recordRunning` calls |
| `src/lib/monthly-report-worker.ts` | Replace 4 `console.*`, add ticks |
| `src/lib/ws-notifications.ts` | Replace 2 `console.*`, track `listening` + clients count |
| `src/app/(dashboard)/settings/page.tsx` | Add `<Link href="/settings/system-health">` card |

---

## Task 1: Logger module

**Files:**
- Create: `src/lib/logger.ts`
- Test: `src/lib/logger.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/logger.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { logger, _setLogLevelForTest } from "./logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    _setLogLevelForTest("debug");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits JSON one-line with ts, level, msg, meta", () => {
    logger.info({ worker: "test", count: 3 }, "hello");
    expect(logSpy).toHaveBeenCalledOnce();
    const raw = logSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(raw);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.worker).toBe("test");
    expect(parsed.count).toBe(3);
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("routes warn → console.warn and error → console.error", () => {
    logger.warn({ worker: "t" }, "w");
    logger.error({ worker: "t" }, "e");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("suppresses debug below threshold", () => {
    _setLogLevelForTest("info");
    logger.debug({ worker: "t" }, "ignored");
    logger.info({ worker: "t" }, "kept");
    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it("handles circular meta without throwing", () => {
    const a: Record<string, unknown> = { worker: "t" };
    a.self = a;
    expect(() => logger.info(a, "x")).not.toThrow();
    expect(logSpy).toHaveBeenCalledOnce();
    const raw = logSpy.mock.calls[0]![0] as string;
    expect(raw).toContain('"msg":"x"');
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run src/lib/logger.test.ts`
Expected: FAIL — module `./logger` not found.

- [ ] **Step 3: Implement logger**

Create `src/lib/logger.ts`:

```typescript
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function defaultLevel(): Level {
  const env = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

let currentLevel: Level = defaultLevel();

/** @internal test helper */
export function _setLogLevelForTest(level: Level): void {
  currentLevel = level;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return JSON.stringify({ note: "circular", value: String(obj) });
  }
}

function emit(level: Level, meta: Record<string, unknown>, msg: string): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel]) return;
  const record = { ts: new Date().toISOString(), level, msg, ...meta };
  const line = safeStringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

export const logger = {
  debug: (meta: Record<string, unknown>, msg: string) => emit("debug", meta, msg),
  info: (meta: Record<string, unknown>, msg: string) => emit("info", meta, msg),
  warn: (meta: Record<string, unknown>, msg: string) => emit("warn", meta, msg),
  error: (meta: Record<string, unknown>, msg: string) => emit("error", meta, msg),
};
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/lib/logger.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logger.ts src/lib/logger.test.ts
git commit -m "feat(observability): add thin JSON logger (H9 task 1)"
```

---

## Task 2: Worker metrics registry

**Files:**
- Create: `src/lib/worker-metrics.ts`
- Test: `src/lib/worker-metrics.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/worker-metrics.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  setStartedAt,
  recordRunning,
  recordTick,
  recordWsListening,
  recordWsConnection,
  snapshot,
  _resetForTest,
} from "./worker-metrics";

describe("worker-metrics", () => {
  beforeEach(() => _resetForTest());

  it("auto-inits a slot on first use", () => {
    recordRunning("alpha", true);
    const s = snapshot().alpha!;
    expect(s.running).toBe(true);
    expect(s.totalCycles).toBe(0);
    expect(s.lastTickAt).toBeNull();
  });

  it("setStartedAt + recordRunning toggle correctly", () => {
    setStartedAt("alpha");
    recordRunning("alpha", true);
    expect(snapshot().alpha!.running).toBe(true);
    expect(snapshot().alpha!.startedAt).not.toBeNull();
    recordRunning("alpha", false);
    expect(snapshot().alpha!.running).toBe(false);
  });

  it("recordTick ok updates lastSuccessAt and durations ring buffer", () => {
    for (let i = 0; i < 12; i++) {
      recordTick("alpha", { ok: true, durationMs: i });
    }
    const s = snapshot().alpha!;
    expect(s.totalCycles).toBe(12);
    expect(s.totalErrors).toBe(0);
    expect(s.lastSuccessAt).not.toBeNull();
    expect(s.lastErrorAt).toBeNull();
    expect(s.recentDurationsMs).toHaveLength(10);
    expect(s.recentDurationsMs[0]).toBe(2);
    expect(s.recentDurationsMs[9]).toBe(11);
  });

  it("recordTick error updates lastErrorAt + lastErrorMessage", () => {
    recordTick("alpha", { ok: false, errorMessage: "boom" });
    const s = snapshot().alpha!;
    expect(s.totalCycles).toBe(1);
    expect(s.totalErrors).toBe(1);
    expect(s.lastErrorAt).not.toBeNull();
    expect(s.lastErrorMessage).toBe("boom");
    expect(s.lastSuccessAt).toBeNull();
  });

  it("recordWsListening and recordWsConnection track ws fields", () => {
    recordWsListening(true);
    recordWsConnection(1);
    recordWsConnection(1);
    recordWsConnection(1);
    recordWsConnection(-1);
    const s = snapshot()["ws-notifications"]!;
    expect(s.listening).toBe(true);
    expect(s.clients).toBe(2);
    expect(s.totalConnections).toBe(3);
  });

  it("clients clamps at 0 even with extra -1", () => {
    recordWsConnection(-1);
    recordWsConnection(-1);
    expect(snapshot()["ws-notifications"]!.clients).toBe(0);
  });

  it("record* functions are no-throw on bad input", () => {
    expect(() => recordTick("", { ok: true })).not.toThrow();
    expect(() => recordRunning("", true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run src/lib/worker-metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement worker-metrics**

Create `src/lib/worker-metrics.ts`:

```typescript
const RECENT_DURATIONS_MAX = 10;

export type WorkerSnapshot = {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  totalCycles: number;
  totalErrors: number;
  recentDurationsMs: number[];
  listening?: boolean;
  clients?: number;
  totalConnections?: number;
};

const _state = new Map<string, WorkerSnapshot>();

function ensureSlot(worker: string): WorkerSnapshot {
  let slot = _state.get(worker);
  if (!slot) {
    slot = {
      running: false,
      startedAt: null,
      lastTickAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      totalCycles: 0,
      totalErrors: 0,
      recentDurationsMs: [],
    };
    _state.set(worker, slot);
  }
  return slot;
}

export function setStartedAt(worker: string): void {
  try {
    ensureSlot(worker).startedAt = new Date().toISOString();
  } catch { /* no-throw */ }
}

export function recordRunning(worker: string, running: boolean): void {
  try {
    ensureSlot(worker).running = running;
  } catch { /* no-throw */ }
}

export function recordTick(
  worker: string,
  args: { ok: boolean; durationMs?: number; errorMessage?: string }
): void {
  try {
    const slot = ensureSlot(worker);
    const now = new Date().toISOString();
    slot.lastTickAt = now;
    slot.totalCycles++;
    if (args.ok) {
      slot.lastSuccessAt = now;
      if (typeof args.durationMs === "number") {
        slot.recentDurationsMs.push(args.durationMs);
        if (slot.recentDurationsMs.length > RECENT_DURATIONS_MAX) {
          slot.recentDurationsMs.shift();
        }
      }
    } else {
      slot.lastErrorAt = now;
      slot.lastErrorMessage = args.errorMessage ?? "unknown";
      slot.totalErrors++;
    }
  } catch { /* no-throw */ }
}

const WS_WORKER = "ws-notifications";

export function recordWsListening(listening: boolean): void {
  try {
    const slot = ensureSlot(WS_WORKER);
    slot.listening = listening;
  } catch { /* no-throw */ }
}

export function recordWsConnection(delta: 1 | -1): void {
  try {
    const slot = ensureSlot(WS_WORKER);
    slot.clients = Math.max(0, (slot.clients ?? 0) + delta);
    if (delta === 1) {
      slot.totalConnections = (slot.totalConnections ?? 0) + 1;
    }
  } catch { /* no-throw */ }
}

export function snapshot(): Record<string, WorkerSnapshot> {
  const out: Record<string, WorkerSnapshot> = {};
  for (const [k, v] of _state.entries()) {
    out[k] = { ...v, recentDurationsMs: [...v.recentDurationsMs] };
  }
  return out;
}

/** @internal test helper */
export function _resetForTest(): void {
  _state.clear();
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/lib/worker-metrics.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/worker-metrics.ts src/lib/worker-metrics.test.ts
git commit -m "feat(observability): add in-memory worker metrics registry (H9 task 2)"
```

---

## Task 3: `/api/healthz` route

**Files:**
- Create: `src/app/api/healthz/route.ts`
- Test: `src/app/api/healthz/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/app/api/healthz/route.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run src/app/api/healthz/route.test.ts`
Expected: FAIL — module `./route` not found.

- [ ] **Step 3: Implement route**

Create `src/app/api/healthz/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { snapshot, type WorkerSnapshot } from "@/lib/worker-metrics";
import pkg from "../../../../package.json" with { type: "json" };

const DB_PING_TIMEOUT_MS = 2000;

async function pingDb(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("db ping timeout")), DB_PING_TIMEOUT_MS)
      ),
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

function deriveStatus(
  db: { ok: boolean },
  workers: Record<string, WorkerSnapshot>
): "ok" | "degraded" | "down" {
  if (!db.ok) return "down";
  for (const [name, w] of Object.entries(workers)) {
    if (name === "ws-notifications" && w.listening === false) return "degraded";
    if (w.lastErrorAt && (!w.lastSuccessAt || w.lastErrorAt > w.lastSuccessAt)) {
      return "degraded";
    }
  }
  return "ok";
}

export async function GET() {
  const authError = await checkAuth();
  if (authError) return authError;

  try {
    const db = await pingDb();
    const workers = snapshot();
    const status = deriveStatus(db, workers);
    const payload = {
      status,
      uptimeSec: Math.round(process.uptime()),
      version: pkg.version,
      db,
      workers,
    };
    const httpStatus = status === "down" ? 503 : 200;
    return NextResponse.json(payload, {
      status: httpStatus,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify tsconfig allows JSON import with assertion**

Run: `grep -E "resolveJsonModule|moduleResolution" tsconfig.json`

If `resolveJsonModule` is not `true`, edit `tsconfig.json` `compilerOptions` to add `"resolveJsonModule": true`. Re-run test after.

- [ ] **Step 5: Run tests, expect pass**

Run: `npx vitest run src/app/api/healthz/route.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/healthz/route.ts src/app/api/healthz/route.test.ts tsconfig.json
git commit -m "feat(observability): admin /api/healthz with DB ping + worker snapshot (H9 task 3)"
```

---

## Task 4: System health page (client)

**Files:**
- Create: `src/app/(dashboard)/settings/system-health/page.tsx`

- [ ] **Step 1: Implement page**

Create `src/app/(dashboard)/settings/system-health/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

type WorkerSnapshot = {
  running: boolean;
  startedAt: string | null;
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  totalCycles: number;
  totalErrors: number;
  recentDurationsMs: number[];
  listening?: boolean;
  clients?: number;
  totalConnections?: number;
};

type Healthz = {
  status: "ok" | "degraded" | "down";
  uptimeSec: number;
  version: string;
  db: { ok: boolean; latencyMs: number };
  workers: Record<string, WorkerSnapshot>;
};

const REFRESH_MS = 30000;

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return ts;
  }
}

function statusBadgeClass(status: "ok" | "degraded" | "down"): string {
  if (status === "ok") return "bg-green-100 text-green-800 ring-green-200";
  if (status === "degraded") return "bg-amber-100 text-amber-800 ring-amber-200";
  return "bg-red-100 text-red-800 ring-red-200";
}

function statusLabel(status: "ok" | "degraded" | "down"): string {
  if (status === "ok") return "OK";
  if (status === "degraded") return "Degradato";
  return "Giù";
}

export default function SystemHealthPage() {
  const [data, setData] = useState<Healthz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);

  const fetchNow = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/healthz", { cache: "no-store" });
      const body = (await res.json()) as Healthz | { error: string };
      if ("status" in body) {
        setData(body);
        setError(null);
      } else {
        setError("Risposta inattesa dal server");
      }
    } catch {
      setError("Impossibile contattare il server, riprovo automaticamente");
    } finally {
      setLastFetchAt(Date.now());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNow();
    const id = setInterval(() => void fetchNow(), REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchNow]);

  const secondsAgo = lastFetchAt ? Math.round((Date.now() - lastFetchAt) / 1000) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">
          Stato sistema
        </h1>
        {data && (
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${statusBadgeClass(data.status)}`}
          >
            {statusLabel(data.status)}
          </span>
        )}
        <span className="text-xs text-on-surface-variant">
          {secondsAgo !== null ? `aggiornato ${secondsAgo}s fa` : ""}
        </span>
        <button
          type="button"
          onClick={() => void fetchNow()}
          disabled={loading}
          className="ml-auto rounded-md bg-primary px-3 py-1 text-xs font-semibold text-on-primary disabled:opacity-50"
        >
          {loading ? "..." : "Aggiorna ora"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="text-sm text-on-surface-variant">Caricamento...</div>
      )}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg bg-surface-container-lowest shadow-card p-4">
            <h2 className="text-sm font-semibold text-on-surface">Database</h2>
            <p className="mt-2 text-xs text-on-surface-variant">
              Stato:{" "}
              <span className={data.db.ok ? "text-green-700" : "text-red-700"}>
                {data.db.ok ? "OK" : "DOWN"}
              </span>
            </p>
            <p className="text-xs text-on-surface-variant">Latency: {data.db.latencyMs} ms</p>
            <p className="text-xs text-on-surface-variant">
              Uptime processo: {Math.round(data.uptimeSec / 60)} min · v{data.version}
            </p>
          </div>

          {Object.entries(data.workers).map(([name, w]) => (
            <div key={name} className="rounded-lg bg-surface-container-lowest shadow-card p-4">
              <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2">
                {name}
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    w.running ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"
                  }`}
                >
                  {w.running ? "running" : "stopped"}
                </span>
              </h2>
              <dl className="mt-2 space-y-1 text-xs text-on-surface-variant">
                <div>
                  <dt className="inline font-semibold">Avviato: </dt>
                  <dd className="inline">{fmtTs(w.startedAt)}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Ultimo successo: </dt>
                  <dd className="inline">{fmtTs(w.lastSuccessAt)}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Cicli totali: </dt>
                  <dd className="inline">{w.totalCycles}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Errori totali: </dt>
                  <dd className="inline">{w.totalErrors}</dd>
                </div>
                {w.lastErrorAt && (
                  <div className="mt-1 rounded bg-red-50 p-2 text-red-800">
                    <div className="font-semibold">Ultimo errore: {fmtTs(w.lastErrorAt)}</div>
                    <div className="break-words">
                      {(w.lastErrorMessage ?? "").slice(0, 200)}
                    </div>
                  </div>
                )}
                {name === "ws-notifications" && (
                  <>
                    <div>
                      <dt className="inline font-semibold">Listening: </dt>
                      <dd className="inline">{w.listening ? "yes" : "no"}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Client connessi: </dt>
                      <dd className="inline">{w.clients ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Connessioni totali: </dt>
                      <dd className="inline">{w.totalConnections ?? 0}</dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "system-health"`
Expected: empty output (no new errors from this file).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/settings/system-health/page.tsx
git commit -m "feat(observability): /settings/system-health admin page with 30s auto-refresh (H9 task 4)"
```

---

## Task 5: Integrate logger + metrics into mail-ingest

**Files:**
- Modify: `src/lib/mail-ingest.ts`

- [ ] **Step 1: Replace console.* and add metrics**

Apply these edits in `src/lib/mail-ingest.ts`:

Add imports at the top of the file (after existing imports):

```typescript
import { logger } from "./logger";
import { recordRunning, recordTick, setStartedAt } from "./worker-metrics";
```

Constant for the worker tag — add just below the existing `const MAX_PER_CYCLE = 50;`:

```typescript
const WORKER = "mail-ingest";
```

Replace `ensureMailPollerStarted` body:

```typescript
export function ensureMailPollerStarted() {
  if (_running) return;
  if (!isMailIngestConfigured()) {
    logger.info({ worker: WORKER }, "graph not configured, poller disabled");
    return;
  }
  _running = true;
  setStartedAt(WORKER);
  recordRunning(WORKER, true);
  logger.info({ worker: WORKER }, "poller started (Graph API)");
  scheduleNext(0);
}
```

Replace `stopMailPoller` body:

```typescript
export function stopMailPoller() {
  _running = false;
  recordRunning(WORKER, false);
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}
```

Replace `scheduleNext` body (the existing one starting at the current `_timer = setTimeout(...)` block):

```typescript
function scheduleNext(delayMs: number) {
  if (!_running) return;
  _timer = setTimeout(async () => {
    const started = Date.now();
    let ok = true;
    let errorMessage: string | undefined;
    try {
      await runOnce();
    } catch (err) {
      ok = false;
      errorMessage = String(err);
      logger.error({ worker: WORKER, err: String(err) }, "cycle error");
    }
    recordTick(WORKER, { ok, durationMs: Date.now() - started, errorMessage });
    const intervalSec = parseInt(process.env.MAIL_POLL_INTERVAL_SEC || "120", 10);
    scheduleNext(intervalSec * 1000);
  }, delayMs);
}
```

Inside `runOnce`, replace the remaining `console.*` calls one-for-one:

- `console.error("[mail-ingest] findFolderIdByName failed:", err);` →
  `logger.error({ worker: WORKER, err: String(err) }, "findFolderIdByName failed");`

- `console.warn(\`[mail-ingest] folder "${folderName}" non trovata nella mailbox\`);` →
  `logger.warn({ worker: WORKER, folder: folderName }, "folder not found in mailbox");`

- `console.error("[mail-ingest] processOne failed for message", msg.id, err);` →
  `logger.error({ worker: WORKER, msgId: msg.id, err: String(err) }, "processOne failed");`

- `console.log("[mail-ingest] cycle done:", stats);` →
  `logger.info({ worker: WORKER, ...stats }, "cycle done");`

- [ ] **Step 2: Verify no `console.` remains in this file**

Run: `grep -nE "console\." src/lib/mail-ingest.ts`
Expected: empty output.

- [ ] **Step 3: Typecheck + lint + existing tests**

Run: `npx tsc --noEmit 2>&1 | grep "mail-ingest"`
Expected: empty.

Run: `npx vitest run` (full suite)
Expected: same baseline as before (no new failures).

- [ ] **Step 4: Commit**

```bash
git add src/lib/mail-ingest.ts
git commit -m "feat(observability): instrument mail-ingest with logger + metrics (H9 task 5)"
```

---

## Task 6: Integrate logger + metrics into monthly-report-worker

**Files:**
- Modify: `src/lib/monthly-report-worker.ts`

- [ ] **Step 1: Replace console.* and add metrics**

Apply these edits in `src/lib/monthly-report-worker.ts`:

Add imports at the top:

```typescript
import { logger } from "./logger";
import { recordRunning, recordTick, setStartedAt } from "./worker-metrics";
```

Add worker tag below the existing `CHECK_INTERVAL_MS` constant:

```typescript
const WORKER = "monthly-report";
```

Replace `generateAndSend` `console.*` lines:

- `console.log(\`[monthly-report] Generating report for ${monthLabel}...\`);` →
  `logger.info({ worker: WORKER, monthLabel }, "generating report");`

- `console.warn(\`[monthly-report] sendMail returned false for ${admin.email}\`);` →
  `logger.warn({ worker: WORKER, to: admin.email }, "sendMail returned false");`

- `console.error(\`[monthly-report] sendMail failed for ${admin.email}:\`, err);` →
  `logger.error({ worker: WORKER, to: admin.email, err: String(err) }, "sendMail failed");`

- `console.log(\`[monthly-report] Sent ${monthLabel} report to ${sentCount}/${admins.length} admins\`);` →
  `logger.info({ worker: WORKER, monthLabel, sentCount, totalAdmins: admins.length }, "report sent");`

Replace the `runCheck` function body (the entire function) to instrument tick:

```typescript
async function runCheck(): Promise<void> {
  const started = Date.now();
  try {
    const enabled = await getSetting("monthlyReportEnabled");
    if (enabled === "false") {
      recordTick(WORKER, { ok: true, durationMs: Date.now() - started });
      return;
    }

    const dayStr = await getSetting("monthlyReportDay");
    const day = dayStr ? parseInt(dayStr, 10) : 5;
    const now = new Date();

    if (now.getDate() !== day) {
      recordTick(WORKER, { ok: true, durationMs: Date.now() - started });
      return;
    }

    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastSent = await getSetting("lastReportSent");
    if (lastSent === currentYearMonth) {
      recordTick(WORKER, { ok: true, durationMs: Date.now() - started });
      return;
    }

    await generateAndSend();
    await setSetting("lastReportSent", currentYearMonth);
    _retryScheduled = false;
    recordTick(WORKER, { ok: true, durationMs: Date.now() - started });
  } catch (err) {
    logger.error({ worker: WORKER, err: String(err) }, "runCheck failed");
    recordTick(WORKER, {
      ok: false,
      durationMs: Date.now() - started,
      errorMessage: String(err),
    });
    if (!_retryScheduled) {
      _retryScheduled = true;
      logger.info({ worker: WORKER }, "scheduling retry in 1 hour");
      setTimeout(() => {
        _retryScheduled = false;
        void runCheck().then(() => {
          const now = new Date();
          const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          return setSetting("lastReportSent", ym);
        }).catch((e) =>
          logger.error({ worker: WORKER, err: String(e) }, "retry also failed")
        );
      }, CHECK_INTERVAL_MS);
    }
  }
}
```

Replace `ensureMonthlyReportWorkerStarted` body:

```typescript
export function ensureMonthlyReportWorkerStarted(): void {
  if (_running) return;
  _running = true;
  setStartedAt(WORKER);
  recordRunning(WORKER, true);
  logger.info({ worker: WORKER, intervalMs: CHECK_INTERVAL_MS }, "worker started");
  scheduleNext(5000);
}
```

- [ ] **Step 2: Verify no `console.` remains**

Run: `grep -nE "console\." src/lib/monthly-report-worker.ts`
Expected: empty output.

- [ ] **Step 3: Typecheck + full vitest run**

Run: `npx tsc --noEmit 2>&1 | grep "monthly-report"`
Expected: empty.

Run: `npx vitest run`
Expected: same baseline.

- [ ] **Step 4: Commit**

```bash
git add src/lib/monthly-report-worker.ts
git commit -m "feat(observability): instrument monthly-report-worker with logger + metrics (H9 task 6)"
```

---

## Task 7: Integrate logger + metrics into ws-notifications

**Files:**
- Modify: `src/lib/ws-notifications.ts`

- [ ] **Step 1: Replace console.* and add metrics**

Apply these edits in `src/lib/ws-notifications.ts`:

Add imports:

```typescript
import { logger } from "./logger";
import {
  recordRunning,
  recordTick,
  recordWsConnection,
  recordWsListening,
  setStartedAt,
} from "./worker-metrics";
```

Add worker tag below the existing imports:

```typescript
const WORKER = "ws-notifications";
```

Replace `startWsNotificationServer` body — specifically the `listening`, `error`, and `connection` blocks:

```typescript
export function startWsNotificationServer(): void {
  if (_started) return;
  _started = true;

  const port = parseInt(process.env.WS_PORT || "3101", 10);
  const host = process.env.WS_HOST ?? "127.0.0.1";
  const wss = new WebSocketServer({ port, host });

  setStartedAt(WORKER);
  recordRunning(WORKER, true);

  wss.on("listening", () => {
    recordWsListening(true);
    logger.info({ worker: WORKER, host, port }, "WebSocket server listening");
  });

  wss.on("error", (err) => {
    logger.error({ worker: WORKER, err: String(err) }, "WebSocket server error");
    recordTick(WORKER, { ok: false, errorMessage: String(err) });
  });

  wss.on("close", () => {
    recordWsListening(false);
    recordRunning(WORKER, false);
  });

  wss.on("connection", async (ws, req) => {
    const user = await authenticateWsRequest(req);
    if (!user) {
      try {
        ws.close(1008, "unauthorized");
      } catch {
        // already closed
      }
      return;
    }

    recordWsConnection(1);

    // Catch-up: solo eventi che il ruolo può vedere
    const recent = notificationsBus
      .recent()
      .filter((e) => shouldDeliverTo(e, user));
    if (recent.length > 0) {
      try {
        ws.send(JSON.stringify({ type: "init", events: recent }));
      } catch {
        // client gia' disconnesso
      }
    }

    const unsubscribe = notificationsBus.subscribe((evt: NotificationEvent) => {
      if (!shouldDeliverTo(evt, user)) return;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "punch", event: evt }));
        } catch {
          // ignore, verra' pulito al close
        }
      }
    });

    ws.on("close", () => {
      unsubscribe();
      recordWsConnection(-1);
    });

    ws.on("error", () => {
      unsubscribe();
    });

    ws.on("pong", () => {
      // alive
    });
  });

  // Keep-alive: ping ogni 30s per rilevare client morti
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });
}
```

Note: the existing file has two separate `wss.on("close", ...)` handlers in the rewritten code above (one for `recordWsListening(false)`, one for `clearInterval(interval)`). `EventEmitter.on()` supports multiple handlers; both will run. This preserves existing keep-alive behavior.

- [ ] **Step 2: Verify no `console.` remains**

Run: `grep -nE "console\." src/lib/ws-notifications.ts`
Expected: empty output.

- [ ] **Step 3: Typecheck + full vitest run**

Run: `npx tsc --noEmit 2>&1 | grep "ws-notifications"`
Expected: empty.

Run: `npx vitest run`
Expected: same baseline.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ws-notifications.ts
git commit -m "feat(observability): instrument ws-notifications with logger + metrics (H9 task 7)"
```

---

## Task 8: Link system-health from settings index

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Read current page to find a logical insertion point**

The settings page is a grid of `<Link>` cards. Add a new card for "Stato sistema". Use the `Activity` icon from lucide-react (already a dep — check by grepping `from "lucide-react"` in the file).

- [ ] **Step 2: Update import line for lucide-react icons**

In the existing import line `import { Ban, Calendar, ... } from "lucide-react";`, add `Activity` to the alphabetical position:

```typescript
import { Activity, Ban, Calendar, CalendarCog, FileSpreadsheet, KeyRound, Mail, MessageCircle, Nfc, Upload, Users } from "lucide-react";
```

- [ ] **Step 3: Append a new card before the closing `</div>` of the grid**

Add this `<Link>` block inside the grid, after the last existing card:

```tsx
<Link
  href="/settings/system-health"
  className="rounded-lg bg-surface-container-lowest shadow-card p-6 transition-shadow hover:shadow-elevated"
>
  <h2 className="text-lg font-semibold text-on-surface flex items-center gap-2">
    <Activity className="h-4 w-4 text-primary" /> Stato sistema
  </h2>
  <p className="mt-2 text-sm text-on-surface-variant">
    Health check workers (mail-ingest, monthly-report, ws-notifications) + database.
    Auto-refresh ogni 30 secondi.
  </p>
</Link>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "settings/page"`
Expected: empty.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(observability): link Stato sistema from settings index (H9 task 8)"
```

---

## Task 9: Full verification + smoke

- [ ] **Step 1: Confirm no remaining `console.*` in instrumented workers**

Run: `grep -nE "console\." src/lib/mail-ingest.ts src/lib/monthly-report-worker.ts src/lib/ws-notifications.ts`
Expected: empty output.

- [ ] **Step 2: Full lint + typecheck + vitest**

Run in parallel:
- `npm run lint 2>&1 | tail -20`
- `npx tsc --noEmit 2>&1 | grep -c "error TS"`
- `npx vitest run 2>&1 | tail -15`

Expected:
- Lint: 0 errors (warnings carryover OK).
- Typecheck: same baseline count as pre-task1 (7 pre-existing in middleware.test.ts).
- Tests: previous suite + all new tests (logger 4 + worker-metrics 7 + healthz 5 = 16 new) all pass.

- [ ] **Step 3: Local smoke test (manual)**

In one terminal:

```bash
npm run build && npm run start
```

In a browser, log in as admin, then:
1. Open `http://localhost:3100/api/healthz` — expect JSON payload with `status: "ok"`, `db.ok: true`, three workers in `workers`.
2. Open `http://localhost:3100/settings/system-health` — expect status badge + 4 cards. Watch `lastTickAt` for mail-ingest update within ~2 min (default poll interval).
3. From `/settings` index, click the new "Stato sistema" card — expect it to navigate to the health page.

- [ ] **Step 4: Production deploy preparation note (no action)**

Document in commit message that `LOG_LEVEL=info` will be the prod default if not set. No NSSM `AppEnvironmentExtra` change needed unless you want `debug` logs.

- [ ] **Step 5: Final commit + push**

If no extra fixes were needed in Step 1-3, push the branch:

```bash
git push origin main
```

If fixes were needed, commit them with `fix(observability): ...` messages first, then push.

---

## Post-implementation

- Update `C:\Users\bakko\.claude\projects\D--Develop-AI-Hr\memory\session_2026-05-22_resume.md` to mark Gruppo 3 as DONE.
- Update `project_hr_tech_debt_tasklist.md` H9 status to DONE.
