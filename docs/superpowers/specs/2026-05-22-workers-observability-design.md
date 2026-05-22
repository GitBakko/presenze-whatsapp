# Workers Observability — Design (H9)

**Date:** 2026-05-22
**Tech-debt ref:** Gruppo 3 / H9 — Stabilità Workers + Observability
**Driver:** prevenire re-incident tipo 2026-04-17 (40 min downtime non rilevato fino a segnalazione utente). Niente runtime introspection sui 3 workers che condividono processo con il Next runtime.

## 1. Decisioni di scope (raccolte in brainstorming)

| Decisione | Scelta |
|-----------|--------|
| Audience `/api/healthz` | Solo admin manuale + page dashboard. No external uptime monitor |
| Logger lib | Wrapper custom thin, zero deps. Output JSON one-line su stdout (NSSM cattura) |
| Persistenza metriche | Solo in-memory. Reset a restart accettabile (restart rari, instrumentation logga boot) |
| UI surface | Nuova page dedicata `/settings/system-health` con auto-refresh 30s |
| Retention storica | Esclusa (YAGNI) |
| Alerting | Escluso (YAGNI) |
| Prometheus/OpenMetrics export | Escluso (YAGNI) |

## 2. Architettura

3 strati con responsabilità isolate:

```
┌──────────────────────────────────────────────────────────┐
│  workers (mail-ingest, monthly-report, ws-notifications) │
│      │              │                                     │
│      │ logger.info  │ metrics.recordTick                  │
│      ▼              ▼                                     │
│  ┌─────────┐   ┌───────────────────┐                      │
│  │ logger  │   │ worker-metrics    │ (singleton state)    │
│  └─────────┘   └───────────────────┘                      │
│                          │                                │
│                          │ snapshot()                     │
│                          ▼                                │
│                ┌──────────────────┐                       │
│                │ /api/healthz GET │ (admin-only)          │
│                └──────────────────┘                       │
│                          │                                │
│                          │ fetch poll 30s                 │
│                          ▼                                │
│                ┌───────────────────────┐                  │
│                │ /settings/system-     │                  │
│                │  health  (page)       │                  │
│                └───────────────────────┘                  │
└──────────────────────────────────────────────────────────┘
```

## 3. Componenti

### 3.1 `src/lib/logger.ts` (nuovo, ~60 righe)

Custom thin wrapper.

**API:**
```ts
logger.debug(meta, msg)
logger.info(meta, msg)
logger.warn(meta, msg)
logger.error(meta, msg)
```

**Comportamento:**
- `meta` è `Record<string, unknown>` (deve includere `worker` per i workers).
- `msg` è `string`.
- Output: JSON one-line su `console[level]`:
  `{"ts":"2026-05-22T10:30:00.000Z","level":"info","worker":"mail-ingest","msg":"cycle done","scanned":3,"ok":2}`
- Livello soglia da `process.env.LOG_LEVEL` (`debug|info|warn|error`). Default `info` in prod, `debug` in dev (`NODE_ENV !== "production"`).
- Try/catch attorno a `JSON.stringify` per gestire circular refs (fallback `{ts, level, msg, meta: String(meta)}`).

### 3.2 `src/lib/worker-metrics.ts` (nuovo, ~80 righe)

Registry singleton in-memory.

**Types:**
```ts
type WorkerSnapshot = {
  running: boolean;
  startedAt: string | null;       // ISO
  lastTickAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  totalCycles: number;
  totalErrors: number;
  recentDurationsMs: number[];    // ring buffer, max 10
  // ws-notifications only:
  listening?: boolean;
  clients?: number;
  totalConnections?: number;
};
```

**API:**
```ts
setStartedAt(worker: string): void
recordRunning(worker: string, running: boolean): void
recordTick(worker: string, args: { ok: boolean; durationMs?: number; errorMessage?: string }): void
recordWsListening(listening: boolean): void
recordWsConnection(delta: 1 | -1): void
snapshot(): Record<string, WorkerSnapshot>
```

**Comportamento:**
- Tutte le `record*` sono no-throw (catch interno → log warn).
- Auto-init dello slot per worker tag sconosciuto.
- `recentDurationsMs` ring buffer size 10 (shift + push).
- `recordTick` con `ok=true` aggiorna `lastSuccessAt` e push duration. Con `ok=false` aggiorna `lastErrorAt + lastErrorMessage`. In entrambi i casi `lastTickAt` e `totalCycles++` (e `totalErrors++` se errore).

### 3.3 `/api/healthz` route (nuovo)

**File:** `src/app/api/healthz/route.ts`

**Handler:** `GET`. Admin-only via `checkAuth()`.

**Logic:**
1. `checkAuth()` → 401/403 standard.
2. DB ping: `Promise.race([prisma.$queryRaw\`SELECT 1\`, timeout(2000)])`. Misura latency.
3. `snapshot = metrics.snapshot()`.
4. Calcola `status`:
   - `"down"` se `db.ok === false`.
   - `"degraded"` se: qualsiasi worker ha `lastErrorAt > lastSuccessAt`, OPPURE `wsNotifications.listening === false`, OPPURE `mailIngest.running === false`.
   - `"ok"` altrimenti.
5. Risposta JSON con header `Cache-Control: no-store`. Status HTTP 200 se `ok`/`degraded`, 503 se `down`.

**Payload:**
```json
{
  "status": "ok",
  "uptimeSec": 12345,
  "version": "0.4.2",
  "db": { "ok": true, "latencyMs": 4 },
  "workers": {
    "mailIngest": { ... WorkerSnapshot ... },
    "monthlyReport": { ... },
    "wsNotifications": { ... }
  }
}
```

`version` letto da `package.json` (import statico, inlinato a build time).

**Error handling:** catch-all → 500 `{ error: "internal" }` (no stack leak).

### 3.4 `/settings/system-health` page (nuova)

**File:** `src/app/(dashboard)/settings/system-health/page.tsx`

Client component (`"use client"`).

**Layout:**
- Header: titolo "Stato sistema" + status badge globale (verde/giallo/rosso) + "Aggiornato Xs fa" + bottone "Aggiorna ora".
- 4 card responsive grid:
  1. **Database** — badge ok/down, latency ms.
  2. **Mail Ingest** — running, lastSuccessAt, totalCycles, totalErrors, lastError (timestamp + 200 char di message).
  3. **Monthly Report** — running, lastSuccessAt, lastErrorAt + message.
  4. **WebSocket Notifications** — listening, clients connessi ora, totalConnections, lastErrorAt.

**Behavior:**
- `useEffect` con `setInterval` 30000ms → fetch `/api/healthz` → setState.
- Cleanup interval on unmount.
- Stato "fetching" mostra spinner sul bottone refresh.
- Fetch error: banner non bloccante "Impossibile contattare il server, riprovo automaticamente".

**Style:** segue convenzioni esistenti `/settings/*` (Card components già nel design system, niente nuovi atomi).

### 3.5 Integrazioni nei workers esistenti

**`src/lib/mail-ingest.ts`:**
- Rimpiazza 6 `console.*` con `logger.*` (`{ worker: "mail-ingest" }`).
- `ensureMailPollerStarted()`: chiama `setStartedAt("mail-ingest")` + `recordRunning("mail-ingest", true)`.
- `stopMailPoller()`: `recordRunning("mail-ingest", false)`.
- `scheduleNext` cycle wrapper: misura `Date.now()` prima/dopo `runOnce`. In success: `recordTick("mail-ingest", { ok: true, durationMs })`. In catch: `recordTick({ ok: false, durationMs, errorMessage: String(err) })`.

**`src/lib/monthly-report-worker.ts`:**
- Rimpiazza 4 `console.*` con `logger.*` (`{ worker: "monthly-report" }`).
- Boot: `setStartedAt("monthly-report")` + `recordRunning(true)`.
- `runCheck()` wrap con timing + `recordTick`.

**`src/lib/ws-notifications.ts`:**
- Rimpiazza 2 `console.*` con `logger.*`.
- `wss.on("listening")` → `recordWsListening(true)` + `recordRunning("ws-notifications", true)` + `setStartedAt`.
- `wss.on("error", err)` → `logger.error` + `recordTick({ ok: false, errorMessage: String(err) })`.
- `wss.on("close")` (server-level) → `recordWsListening(false)`.
- `on("connection")`: `recordWsConnection(1)` + nel `ws.on("close")` di quella connessione `recordWsConnection(-1)`.

**`src/app/(dashboard)/settings/page.tsx`:**
- Aggiungi link/card "Stato sistema" che porta a `/settings/system-health`.

## 4. Error handling globale

| Livello | Strategia |
|---------|-----------|
| `logger` | Serializzazione fault-tolerant. Mai throw verso il chiamante. |
| `worker-metrics` | Tutti i setter no-throw. Auto-init slot. |
| `/api/healthz` DB ping timeout 2s | Fallisce → `db.ok=false`, status `"down"`, HTTP 503. |
| `/api/healthz` catch-all | 500 `{ error: "internal" }`. |
| Page fetch fail | Banner non bloccante, retry auto al prossimo tick. |
| Workers loop | `recordTick` error mai propagato fuori dal worker cycle. |

## 5. Testing

| Test | Scope |
|------|-------|
| `src/lib/logger.test.ts` | Level filtering (debug suppresso quando `LOG_LEVEL=info`), JSON shape, circular ref fallback, meta merge. Spy su `console.{log,warn,error}`. |
| `src/lib/worker-metrics.test.ts` | `setStartedAt`/`recordRunning` toggling. `recordTick` ok→aggiorna `lastSuccessAt` + ring buffer. error→aggiorna `lastErrorAt + Message`. `recordWsConnection` clamp >=0. `snapshot` shape. |
| `src/app/api/healthz/route.test.ts` | 401 senza auth, 403 non-admin, payload shape con mock prisma+metrics, status `ok/degraded/down` derivation, HTTP 503 quando DB down. |
| Smoke manuale post-deploy | GET `/api/healthz` da browser admin: payload sensato. Attesa 3 min, ricontrolla `mailIngest.totalCycles` incrementato. Apri `/settings/system-health`: cards renderizzano, auto-refresh visibile. |

## 6. Scope esclusioni (YAGNI esplicite)

- ❌ Retention storica metriche (DB time-series).
- ❌ Alerting / notifiche email automatiche.
- ❌ Export Prometheus / OpenMetrics.
- ❌ Log rotation custom (NSSM già rota).
- ❌ Tracing distribuito.
- ❌ Endpoint `/healthz` pubblico per uptime monitor esterno.
- ❌ DB schema changes / Prisma migrations.
- ❌ Performance dashboards beyond ultimo-run + counter.

## 7. File summary

**Nuovi:**
- `src/lib/logger.ts` + `src/lib/logger.test.ts`
- `src/lib/worker-metrics.ts` + `src/lib/worker-metrics.test.ts`
- `src/app/api/healthz/route.ts` + `src/app/api/healthz/route.test.ts`
- `src/app/(dashboard)/settings/system-health/page.tsx`

**Modificati:**
- `src/lib/mail-ingest.ts` — 6 console→logger + tick instrumentation
- `src/lib/monthly-report-worker.ts` — 4 console→logger + tick
- `src/lib/ws-notifications.ts` — 2 console→logger + listening/connection tracking
- `src/app/(dashboard)/settings/page.tsx` — link a system-health

## 8. Effort & rischio

- Stima: ~1 giorno (8h) totali.
- DB schema: nessuno.
- Prisma migration: nessuna.
- Breaking change: nessuno (additive only).
- Deploy: standard via pipeline esistente (zip build + publish, preserva subdir critiche — vedi memoria `project_hr_deploy_pipeline`).
- Env vars nuove: `LOG_LEVEL` opzionale (default `info`). Non aggiungere a NSSM `AppEnvironmentExtra` se default ok.

## 9. Open points (post-implementation)

Da rivalutare quando manca traffico in prod:
- Aggiungere endpoint pubblico minimale se serve uptime monitor esterno futuro.
- Persistere `lastSuccessAt` su AppSetting se restart frequency aumenta.
- Aggiungere page client SSE invece di polling se 30s troppo lento.
