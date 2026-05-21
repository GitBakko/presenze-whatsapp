# Security Sweep — Gruppo 2 (Audit pre-2026-05-21)

**Date:** 2026-05-21
**Phase:** HR tech-debt Gruppo 2 — Sicurezza CRITICAL
**Status:** Design approved, plan pending
**Source:** Task list in `memory/project_hr_tech_debt_tasklist.md`

## Scope

Backend hardening sweep. Nessuna modifica UX, nessun cambio schema DB. Sette item dell'audit, di cui uno (C2) già risolto in `leaves-domain` phase.

| ID | Item | Approccio scelto |
|----|------|------------------|
| C1 | TZ midnight off-by-one — 26 occorrenze `toISOString().split` | Cat A+B (13 replace, server+client now-sites) + ESLint rule `no-iso-split`. Cat C verificata in plan (replace se `hireDate` è `Date`, no-op se `String`). Cat D loop iter deferred |
| C2 | `/api/external/leaves` mis-routing | ✅ DONE in `0c467ec` (leaves-domain phase) — skip |
| C3 | `/api/anomalies/cleanup` CSRF | Middleware CSRF globale + allowlist in `src/middleware.ts` |
| C4 | Telegram webhook secret `!==` + bypass header | Helper `constantTimeEquals` + strict header mode |
| C5 | WS server bind `0.0.0.0:3101` | Env var `WS_HOST` default `127.0.0.1` |
| C7 | `/api/register` aperto + no rate-limit + name non validato | Zod schema + helper `rateLimit` + timing-safe `systemPassword` + email-enum mask |
| H6 | `auth.ts` `any` types | Module augmentation `types/next-auth.d.ts` + consolida `AuthUser` |

## Architettura

Phase compatta backend. Aggiunge 4 file infra riutilizzabili, modifica 6 file core + 13 file con replace meccanico TZ.

### Nuovi file
- `src/lib/crypto-utils.ts` — `constantTimeEquals(a, b)` (C4 + C7)
- `src/lib/rate-limit.ts` — `rateLimit({key, max, windowMs})` in-memory + `getClientIp(req)` (C7)
- `types/next-auth.d.ts` — module augmentation (H6)
- `eslint-rules/no-iso-split.js` — custom ESLint rule (C1)

### File modificati core
- `src/middleware.ts` — CSRF origin check (C3)
- `src/lib/ws-notifications.ts` — `WS_HOST` env (C5)
- `src/lib/auth.ts` — rimuovi `as any` (H6)
- `src/lib/auth-guard.ts` — `AuthUser` = `Session["user"]` (H6)
- `src/app/api/telegram/webhook/[secret]/route.ts` — const-time + strict header (C4)
- `src/app/api/telegram/setup/route.ts` — verifica passa `secret_token` a `setWebhook` (C4 pre-req)
- `src/app/api/register/route.ts` — Zod + rateLimit + const-time + mask (C7)

### File modificati TZ replace (C1)
**Cat A — server-side now-sites (5)**
- `src/lib/dashboard-helpers.ts:23,31,32,68,120`
- `src/app/api/anomalies/count/route.ts:9`
- `src/app/api/attendance/route.ts:28`
- `src/app/api/stats/dashboard/route.ts:57,58`

**Cat B — client-side now-sites (8)**
- `src/app/(dashboard)/anomalies/page.tsx:105,109`
- `src/app/(dashboard)/employees/[id]/page.tsx:154`
- `src/app/(dashboard)/leaves/_components/CalendarView.tsx:29`
- `src/app/(dashboard)/leaves/_components/GanttCalendar.tsx:169`
- `src/app/(dashboard)/page.tsx:166,167`
- `src/app/(dashboard)/records/page.tsx:65`
- `src/components/dashboard/AnomalyList.tsx:14,18`

**Cat C** — verifica schema `hireDate` in plan: se `String` skip, se `DateTime` 3 replace (`api/employees/route.ts:101`, `[id]/route.ts:45,281`)
**Cat D** — deferred, follow-up `C1-LOOPS-DEFERRED`

### Config
- `.eslintrc.*` / `eslint.config.mjs` — registra rule `no-iso-split`
- `package.json` — eventuale dev-dep per Vitest mock helper (`@vitest/mock-fetch`?) se serve per integration test routes

### Non tocco
- Schema Prisma, migration DB
- UI/UX pages (solo replace TZ)
- Routing pages, layout
- Workers (mail-ingest, monthly-report)
- Kiosk endpoints, external leaves API (oltre a quanto già in C2)

## Component contracts

### `crypto-utils.ts`
```ts
import { timingSafeEqual } from "node:crypto";

export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
```
- Pure, no state, no side effect
- Returns false on length differ (length non è secret)
- Throws solo se Buffer.from fail (input non-string) → caller deve passare string

### `rate-limit.ts`
```ts
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitOpts {
  key: string;        // es. `register:${ip}`
  max: number;
  windowMs: number;
}
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(opts: RateLimitOpts): RateLimitResult { /* ... */ }
export function getClientIp(req: Request): string { /* X-Forwarded-For first hop → x-real-ip → "unknown" */ }
```
- In-memory `Map`. Cleanup lazy on read (drop expired bucket prima di check)
- Single-instance NSSM OK. Restart resetta — accettato
- `getClientIp`: prima trust IIS che setta XFF; spoofing client mitigato perché IIS sovrascrive (verifica in implementazione)

### `middleware.ts` — CSRF guard
```ts
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_ALLOWLIST: RegExp[] = [
  /^\/api\/auth\//,
  /^\/api\/kiosk\//,
  /^\/api\/external\//,
  /^\/api\/telegram\/webhook\//,
  /^\/api\/employee-portal\//,  // verificare in plan: se Bearer/JWT proprio → allowlist; se session cookie → rimuovere
  /^\/api\/register$/,
];
// In middleware function, after existing NextAuth check:
if (MUTATING.has(req.method) && !CSRF_ALLOWLIST.some(r => r.test(pathname))) {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  if (origin) {
    if (new URL(origin).host !== host) return new Response("CSRF blocked", { status: 403 });
  } else if (referer) {
    if (new URL(referer).host !== host) return new Response("CSRF blocked", { status: 403 });
  } else {
    return new Response("CSRF blocked", { status: 403 });
  }
}
```
- Method allowlist: solo mutating
- Path allowlist: endpoint che hanno auth proprio (NextAuth, kiosk Bearer, external Bearer, telegram secret, employee-portal Bearer, register self-rate-limited)
- Header allowlist: `Origin` primary, `Referer` fallback. Entrambi missing → 403

### `next-auth.d.ts` — Module augmentation
```ts
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "EMPLOYEE";
    active: boolean;
    employeeId: string | null;
  }
  interface Session {
    user: User;
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "ADMIN" | "EMPLOYEE";
    active: boolean;
    employeeId: string | null;
  }
}
```
- `AuthUser` in `auth-guard.ts` diventa `type AuthUser = Session["user"]`
- Rimuove `as any` da `auth.ts` jwt + session callbacks
- TS strict-check di token.role, session.user.role, etc.

### ESLint rule `no-iso-split`
```js
module.exports = {
  meta: { type: "problem", docs: { description: "Use todayRome() from @/lib/tz instead of toISOString().split for date extraction" }},
  create(context) {
    const filename = context.getFilename().replace(/\\/g, "/");
    if (filename.endsWith("/lib/tz.ts")) return {};
    return {
      CallExpression(node) {
        if (
          node.callee?.type === "MemberExpression" &&
          node.callee.property?.name === "split" &&
          node.callee.object?.type === "CallExpression" &&
          node.callee.object.callee?.type === "MemberExpression" &&
          node.callee.object.callee.property?.name === "toISOString"
        ) {
          context.report({ node, message: "Use todayRome() from @/lib/tz" });
        }
      }
    };
  }
};
```
- Alternativa: `no-restricted-syntax` in eslint.config con pattern. Preferito custom rule per messaggio chiaro.

## Data flow per endpoint

### Telegram webhook (C4)
```
POST /api/telegram/webhook/[secret]
  → expected = env.TELEGRAM_WEBHOOK_SECRET (503 se missing)
  → constantTimeEquals(secret, expected) → 403 se fail
  → headerSecret = req.headers.x-telegram-bot-api-secret-token
  → STRICT: !headerSecret → 403
  → constantTimeEquals(headerSecret, expected) → 403 se fail
  → parse JSON → 400 malformed
  → handleTelegramUpdate → 200 OK sempre
```
**Pre-req:** `/api/telegram/setup` deve chiamare `setWebhook` con `secret_token: expected`. Plan verifica + fixa.

### Register (C7)
```
POST /api/register
  → ip = getClientIp(req)
  → rateLimit({ key: `register:${ip}`, max: 5, windowMs: 15*60_000 })
       → 429 + Retry-After
  → Zod parse:
       email: string().email().max(200)
       name: string().min(1).max(100).regex(/^[\p{L}\p{N}\s'.-]+$/u)
       password: string().min(8).max(128)
       systemPassword: string().max(200).optional()
       → 400 errori
  → isAdminReg = !!systemPassword && constantTimeEquals(systemPassword, env.SYSTEM_REGISTRATION_SECRET)
  → if systemPassword && !isAdminReg → 403 (mask off, è path admin)
  → if !isAdminReg → check domain @epartner.it → 403 specific
  → existing = findUnique(email)
  → if isAdminReg && existing → 409 reale
  → if !isAdminReg && existing → 202 mask "registrazione ricevuta, controlla email"
  → create user
  → if isAdminReg → 201 dettagli
  → if !isAdminReg → 202 mask uniforme
```
- Mask uniforme employee path: nasconde se email è già registrata
- Admin path mostra esito reale (dietro secret, no enum attack)
- Rate-limit cattura bruteforce SYSTEM_REGISTRATION_SECRET prima del const-time

### CSRF middleware (C3)
```
Request → middleware
  → NextAuth auth() guard (esistente)
  → if mutating && !allowlist:
       Origin present → host match? else 403
       Origin absent → Referer → host match? else 403
       Both absent → 403
  → forward
```

### WS server (C5)
```
instrumentation.ts → startWsNotificationServer
  → port = env.WS_PORT || 3101
  → host = env.WS_HOST || "127.0.0.1"   ← cambio
  → new WebSocketServer({ port, host })
  → IIS ARR reverse-proxy → ws://127.0.0.1:3101 (web.config invariato)
```
NSSM `AppEnvironmentExtra` aggiunge `WS_HOST=127.0.0.1` (opzionale, default già safe).

### C1 TZ replace
```
PRIMA: const today = new Date().toISOString().split("T")[0];
DOPO:  import { todayRome } from "@/lib/tz"; const today = todayRome();
```

## Error handling

### Telegram webhook
- Header missing in strict mode → 403 — **rischio rottura**: pre-deploy verifica `/api/telegram/setup` invii `secret_token`. Re-setup webhook su prod prima di flip strict
- Length mismatch in const-time → false immediato (length non secret)

### Register
- Rate-limit exceeded → 429 + `Retry-After: <s>` + body `{ error: "rate_limited", retryAfter: <s> }`
- Zod fail → 400 + `{ errors: [{path, message}] }` (no leak constraint interni)
- Email duplicate → 202 mask (employee) / 409 reale (admin)
- IP detection edge: dietro IIS allowlist XFF (vedi `project_hr_prod_environment`). First hop accettato

### CSRF middleware
- Origin missing → fallback Referer
- Entrambi missing → 403 (sospetto)
- Server-to-server senza Bearer/external → 403 a meno di allowlist
- NextAuth signin form → `/api/auth/*` in allowlist (NextAuth CSRF interno)

### WS bind
- Rollback: `WS_HOST=0.0.0.0` ripristina default precedente
- Health check post-deploy: `Test-NetConnection 127.0.0.1 -Port 3101` su server

### C1 TZ
- Cat C `hireDate.toISOString().split` — verifica schema: `hireDate` è `String?` "YYYY-MM-DD" o `DateTime?`. Plan verifica. Se String → no replace; se Date → `todayRome(date)`
- Cat D loops UTC midnight → deferred. Documento commit. Audit follow-up
- `todayRome()` works server + browser (Intl.DateTimeFormat universale)

### Module augmentation
- NextAuth default `User.id?` optional → augmentation force required. Verifica TS non lamenti
- `email: string | null` default → augmentation force `string` (credentials provider sempre presente)

## Testing strategy

### Unit (Vitest)
- `src/lib/crypto-utils.test.ts` — same/diff/length-differ/empty/unicode
- `src/lib/rate-limit.test.ts` — 1° hit, max+1, post-window reset, key isolation, getClientIp XFF/x-real-ip/fallback
- `src/lib/tz.test.ts` — formato output, midnight Europe/Rome vs UTC, cross-DST

### Integration (Vitest + Next route handler test)
- `src/app/api/telegram/webhook/[secret]/route.test.ts` — wrong secret/no header/wrong header/right both/missing env
- `src/app/api/register/route.test.ts` — valid employee mask, existing email mask uniforme, wrong systemPassword 403, rate-limit 429, Zod fail XSS-name, Zod fail too-long
- `src/middleware.test.ts` — POST same-origin OK, POST cross-origin 403, /api/auth allowlist OK, GET no-CSRF-check, kiosk allowlist OK

### Smoke manuale post-deploy
1. WS connect via browser → notifica live
2. Telegram `/saldo` → bot risponde
3. Register employee `@epartner.it` → 202 + DB record inactive
4. Register same email → 202 (uniforme)
5. CSRF block: `curl -X POST -H "Origin: https://evil.com" -H "Cookie: <sessione>" .../api/leaves` → 403
6. Dashboard at midnight Europe/Rome (eyeball check sera deploy)

### ESLint rule
- Test fixture file con violation → expect lint error
- Snapshot `npm run lint` post-replace → 0 violazioni

### Gates
| Gate | Criterio |
|------|----------|
| Build | `npx next build` 0 errors |
| Lint | `npm run lint` 0 warnings |
| Unit | Vitest pass (escluso pre-existing `calculator pause-from-hours`) |
| Smoke | 6 punti smoke OK pre-merge |
| Deploy | Build → zip verify → publish-server.ps1 → curl health check |

## Risks & mitigations

| Rischio | Mitigation |
|---------|------------|
| Telegram webhook 403 dopo deploy (strict header) | Plan ordina: 1° verifica `setup/route.ts` invii `secret_token`, 2° re-call setup endpoint pre-deploy, 3° flip strict |
| CSRF middleware blocca legittime call interne | Allowlist conservativa, smoke test su tutte le route mutating principali prima merge |
| `WS_HOST=127.0.0.1` rompe se ARR su altra macchina | Memoria conferma server single-host. Rollback documentato |
| ESLint rule false-positive | Pattern stretto (chained `.toISOString().split`). Dry-run pre-merge |
| `todayRome()` divergenza server-client | Intl.DateTimeFormat universale. Documentato in test |
| Rate-limit in-memory perso al restart | Accettato (single-instance NSSM, restart raro, attaccanti devono ricominciare comunque) |
| Cat C `hireDate` schema check | Plan verifica schema prima replace; se String skip, se Date → `todayRome(d)` |

## Deferred / follow-up

- C1 Cat D (loop date iter) — verificare se UTC intenzionale o bug. Issue separato dopo Gruppo 2
- C1 Cat C `hireDate` se schema `String` → no-op. Se `Date` → da fare in questa phase
- Audit timing-safe altri secret compares (API key, JWT, mail tokens) → Gruppo 5
- Email-enum mask UX: messaggio generic potrebbe confondere utenti legittimi che credono di non essersi mai registrati. Possibile follow-up: invio email "qualcuno ha provato a registrarsi con questo indirizzo" se exists

## Linked memories
- `project_hr_tech_debt_tasklist.md` — master task list, this phase aggiorna stato
- `project_hr_prod_environment.md` — NSSM env vars, IIS reverse-proxy
- `project_hr_deploy_pipeline.md` — build + zip + publish procedure
- `feedback_hr_deploy_caution.md` — cautela max su prod
- `project_hr_leaves_domain.md` — C2 fix history
