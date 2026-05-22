import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { snapshot, type WorkerSnapshot } from "@/lib/worker-metrics";
import pkg from "../../../../package.json" with { type: "json" };

const DB_PING_TIMEOUT_MS = 2000;

async function pingDb(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("db ping timeout")), DB_PING_TIMEOUT_MS);
    });
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      timeout,
    ]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deriveStatus(
  db: { ok: boolean },
  workers: Record<string, WorkerSnapshot>
): "ok" | "degraded" | "down" {
  if (!db.ok) return "down";
  for (const [name, w] of Object.entries(workers)) {
    if (name === "ws-notifications" && w.listening === false) return "degraded";
    if (w.startedAt && w.running === false) return "degraded";
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
