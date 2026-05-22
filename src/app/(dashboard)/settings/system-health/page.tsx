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
