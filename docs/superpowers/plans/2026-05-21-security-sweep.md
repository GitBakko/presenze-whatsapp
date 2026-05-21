# Security Sweep — Gruppo 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement backend security hardening from `docs/superpowers/specs/2026-05-21-security-sweep-design.md`: C1 TZ off-by-one (Cat A+B+C), C3 CSRF middleware, C4 Telegram const-time + strict header, C5 WS_HOST env, C7 register Zod + rate-limit + email-enum mask, H6 NextAuth module augmentation.

**Architecture:** Foundation-first TDD. Helpers (`crypto-utils`, `rate-limit`) and types (`next-auth.d.ts`) first, then consumers (telegram webhook, register, middleware), then mechanical TZ replace, then lint rule guard, then build/lint/smoke gates.

**Tech Stack:** Next.js 16, NextAuth v5, Prisma 6, Vitest, TypeScript strict, ESLint flat config (or legacy), Node 24 `node:crypto`.

---

## File structure

### New files
- `src/lib/crypto-utils.ts` — `constantTimeEquals(a, b)` (used by C4, C7)
- `src/lib/crypto-utils.test.ts`
- `src/lib/rate-limit.ts` — `rateLimit({key, max, windowMs})` + `getClientIp(req)` (used by C7)
- `src/lib/rate-limit.test.ts`
- `types/next-auth.d.ts` — `User`, `Session`, `JWT` module augmentation (H6)
- `eslint-rules/no-iso-split.js` — custom rule forbidding `.toISOString().split` outside `tz.ts` (C1)
- `eslint-rules/no-iso-split.test.js` — RuleTester unit test
- `src/app/api/telegram/webhook/[secret]/route.test.ts` — integration test (C4)
- `src/app/api/register/route.test.ts` — integration test (C7)
- `src/middleware.test.ts` — CSRF middleware test (C3)

### Modified files
- `src/lib/auth.ts` — remove `as any`, use augmentation (H6)
- `src/lib/auth-guard.ts` — `AuthUser` becomes `Session["user"]` alias (H6)
- `src/lib/ws-notifications.ts:46` — `host: process.env.WS_HOST ?? "127.0.0.1"` (C5)
- `src/app/api/telegram/webhook/[secret]/route.ts` — const-time + strict header (C4)
- `src/app/api/telegram/setup/route.ts` — ensure `setWebhook` passes `secret_token` (C4 pre-req)
- `src/app/api/register/route.ts` — Zod + rate-limit + const-time + mask (C7)
- `src/middleware.ts` — CSRF same-origin check (C3)
- `package.json` — add `zod` if missing; add eslint-plugin local
- `eslint.config.mjs` (or `.eslintrc.*`) — register `no-iso-split` rule (C1)
- TZ Cat A (5 server-side files): `src/lib/dashboard-helpers.ts`, `src/app/api/anomalies/count/route.ts`, `src/app/api/attendance/route.ts`, `src/app/api/stats/dashboard/route.ts`
- TZ Cat B (8 client-side files): `src/app/(dashboard)/anomalies/page.tsx`, `src/app/(dashboard)/employees/[id]/page.tsx`, `src/app/(dashboard)/leaves/_components/CalendarView.tsx`, `src/app/(dashboard)/leaves/_components/GanttCalendar.tsx`, `src/app/(dashboard)/page.tsx`, `src/app/(dashboard)/records/page.tsx`, `src/components/dashboard/AnomalyList.tsx`
- TZ Cat C (3 hireDate sites, `DateTime?` confirmed): `src/app/api/employees/route.ts:101`, `src/app/api/employees/[id]/route.ts:45,281`

### Not touched
- Prisma schema, DB migrations
- UI pages (only TZ replace mechanical)
- Workers (mail-ingest, monthly-report)
- Kiosk/external/employee-portal endpoint logic

---

## Task 1: `constantTimeEquals` helper (C4 + C7 foundation)

**Files:**
- Create: `src/lib/crypto-utils.ts`
- Create: `src/lib/crypto-utils.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/crypto-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { constantTimeEquals } from "./crypto-utils";

describe("constantTimeEquals", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEquals("hello", "hello")).toBe(true);
  });

  it("returns false for different strings same length", () => {
    expect(constantTimeEquals("hello", "world")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(constantTimeEquals("hello", "hell")).toBe(false);
    expect(constantTimeEquals("a", "ab")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(constantTimeEquals("", "")).toBe(true);
  });

  it("handles multi-byte unicode correctly", () => {
    expect(constantTimeEquals("café", "café")).toBe(true);
    expect(constantTimeEquals("café", "cafè")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run src/lib/crypto-utils.test.ts`
Expected: FAIL with "Cannot find module './crypto-utils'"

- [ ] **Step 3: Implement helper**

Create `src/lib/crypto-utils.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string compare. Returns false immediately on length mismatch
 * (length itself is not secret).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run src/lib/crypto-utils.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto-utils.ts src/lib/crypto-utils.test.ts
git commit -m "feat(security): add constantTimeEquals helper

Used by upcoming Telegram webhook and /api/register fixes
to prevent timing-attack secret comparison.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: `rateLimit` + `getClientIp` helper (C7 foundation)

**Files:**
- Create: `src/lib/rate-limit.ts`
- Create: `src/lib/rate-limit.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/rate-limit.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { rateLimit, getClientIp, _resetBucketsForTest } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    _resetBucketsForTest();
  });

  it("allows first hit", () => {
    const r = rateLimit({ key: "test:1", max: 3, windowMs: 60_000 });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("blocks after max hits in window", () => {
    rateLimit({ key: "test:2", max: 2, windowMs: 60_000 });
    rateLimit({ key: "test:2", max: 2, windowMs: 60_000 });
    const r = rateLimit({ key: "test:2", max: 2, windowMs: 60_000 });
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("resets after window expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T10:00:00Z"));
    rateLimit({ key: "test:3", max: 1, windowMs: 1000 });
    const blocked = rateLimit({ key: "test:3", max: 1, windowMs: 1000 });
    expect(blocked.ok).toBe(false);
    vi.setSystemTime(new Date("2026-05-21T10:00:02Z"));
    const reset = rateLimit({ key: "test:3", max: 1, windowMs: 1000 });
    expect(reset.ok).toBe(true);
    vi.useRealTimers();
  });

  it("isolates keys", () => {
    rateLimit({ key: "key-a", max: 1, windowMs: 60_000 });
    const blockedA = rateLimit({ key: "key-a", max: 1, windowMs: 60_000 });
    const okB = rateLimit({ key: "key-b", max: 1, windowMs: 60_000 });
    expect(blockedA.ok).toBe(false);
    expect(okB.ok).toBe(true);
  });
});

describe("getClientIp", () => {
  function mkReq(headers: Record<string, string>): Request {
    return new Request("http://localhost/test", { headers });
  }

  it("returns first hop of X-Forwarded-For", () => {
    const req = mkReq({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const req = mkReq({ "x-real-ip": "5.6.7.8" });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no header", () => {
    const req = mkReq({});
    expect(getClientIp(req)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run src/lib/rate-limit.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement helper**

Create `src/lib/rate-limit.ts`:

```ts
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitOpts {
  key: string;
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(opts: RateLimitOpts): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(opts.key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(opts.key, bucket);
  }
  bucket.count++;
  const ok = bucket.count <= opts.max;
  const remaining = Math.max(0, opts.max - bucket.count);
  return { ok, remaining, resetAt: bucket.resetAt };
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/** @internal test helper */
export function _resetBucketsForTest(): void {
  buckets.clear();
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run src/lib/rate-limit.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit.ts src/lib/rate-limit.test.ts
git commit -m "feat(security): add rate-limit + getClientIp helpers

In-memory sliding-window rate limiter (single-instance NSSM OK).
Used by upcoming /api/register hardening.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: NextAuth module augmentation (H6)

**Files:**
- Create: `types/next-auth.d.ts`
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/auth-guard.ts`
- Verify: `tsconfig.json` includes `types/**/*.d.ts`

- [ ] **Step 1: Verify tsconfig.json includes the types directory**

Run: `cat tsconfig.json`

Look for `include` array. If it does not include `"types/**/*.d.ts"` or `"**/*.ts"` (which would cover it), add:
```json
"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", "types/**/*.d.ts", ".next/types/**/*.ts"]
```
If `"**/*.ts"` is already present, no edit needed.

- [ ] **Step 2: Create augmentation file**

Create `types/next-auth.d.ts`:

```ts
import type { DefaultSession } from "next-auth";

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
    user: {
      id: string;
      email: string;
      name: string;
      role: "ADMIN" | "EMPLOYEE";
      active: boolean;
      employeeId: string | null;
    } & DefaultSession["user"];
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

- [ ] **Step 3: Update auth.ts to use augmentation (remove `as any`)**

Edit `src/lib/auth.ts`, replace the `callbacks` block with:

```ts
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.active = user.active;
        token.employeeId = user.employeeId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.active = token.active;
        session.user.employeeId = token.employeeId;
      }
      return session;
    },
  },
```

Remove the two `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments and the `as any` casts.

- [ ] **Step 4: Consolidate AuthUser in auth-guard.ts**

Edit `src/lib/auth-guard.ts`. Replace the existing `AuthUser` interface declaration:

```ts
import type { Session } from "next-auth";
import { auth } from "./auth";

export type AuthUser = Session["user"];
```

Keep the rest of the file (`checkAuth`, `checkAuthAny`, `isAuthUser`, `resolveEmployeeId`) unchanged. Verify the `user as AuthUser` casts inside those functions still compile.

- [ ] **Step 5: Verify build**

Run: `npx next build`
Expected: build succeeds, no TypeScript errors

If build fails because `session.user.email` is `null` somewhere, the augmentation forces `string`. Look at the error and either: (a) relax augmentation `email: string | null`, or (b) ensure the credentials provider always returns a string email (it does — Prisma `User.email` is `String @unique`).

- [ ] **Step 6: Commit**

```bash
git add types/next-auth.d.ts src/lib/auth.ts src/lib/auth-guard.ts tsconfig.json
git commit -m "feat(security): NextAuth module augmentation (H6)

Adds strict types for User/Session/JWT, removes 'as any' casts in
auth.ts callbacks, consolidates AuthUser as Session['user'] alias.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: WS_HOST env var (C5)

**Files:**
- Modify: `src/lib/ws-notifications.ts:46`

- [ ] **Step 1: Apply edit**

Edit `src/lib/ws-notifications.ts`. Replace:

```ts
  const wss = new WebSocketServer({ port, host: "0.0.0.0" });
```

with:

```ts
  const host = process.env.WS_HOST ?? "127.0.0.1";
  const wss = new WebSocketServer({ port, host });
```

And update the `listening` log line for visibility:

```ts
  wss.on("listening", () => {
    console.log(`[ws-notifications] WebSocket server listening on ${host}:${port}`);
  });
```

- [ ] **Step 2: Verify build**

Run: `npx next build`
Expected: build succeeds

- [ ] **Step 3: Smoke test locally**

Run: `npx next dev` (or kill any running dev server first)
Open browser → http://localhost:3000 → log in → verify WS connects (check Network → WS).
On first run kill `next dev` after confirming.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ws-notifications.ts
git commit -m "feat(security): WS server bind WS_HOST env, default 127.0.0.1 (C5)

Prevents WS port 3101 from being reachable from external interfaces
if firewall is misconfigured. IIS ARR reverse-proxy is local, still works.

Deploy note: add WS_HOST=127.0.0.1 to NSSM AppEnvironmentExtra (optional,
default already safe).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Telegram webhook const-time + strict header (C4)

**Files:**
- Modify: `src/app/api/telegram/webhook/[secret]/route.ts`
- Read: `src/app/api/telegram/setup/route.ts` (verify it passes `secret_token`)
- Create: `src/app/api/telegram/webhook/[secret]/route.test.ts`

- [ ] **Step 1: Verify telegram setup passes secret_token**

Run: `cat src/app/api/telegram/setup/route.ts`

Find the `setWebhook` call. It should send `secret_token: process.env.TELEGRAM_WEBHOOK_SECRET` (or similar) in the body to Telegram API.

If it does NOT, edit it to include `secret_token` in the request body. Example expected shape:

```ts
const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  }),
});
```

If the file already includes `secret_token`, leave it untouched.

- [ ] **Step 2: Write failing integration test**

Create `src/app/api/telegram/webhook/[secret]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/telegram-handlers", () => ({
  handleTelegramUpdate: vi.fn().mockResolvedValue(undefined),
}));

function mkReq(opts: { secret: string; header?: string; body?: unknown }): {
  request: Request;
  params: Promise<{ secret: string }>;
} {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.header !== undefined) headers["x-telegram-bot-api-secret-token"] = opts.header;
  return {
    request: new Request("http://localhost/api/telegram/webhook/anything", {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body ?? { update_id: 1 }),
    }) as unknown as import("next/server").NextRequest,
    params: Promise.resolve({ secret: opts.secret }),
  };
}

describe("POST /api/telegram/webhook/[secret]", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "correct-secret-value-32-chars-aaa";
  });

  it("503 if env missing", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const { request, params } = mkReq({ secret: "any", header: "any" });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(503);
  });

  it("403 if path secret wrong", async () => {
    const { request, params } = mkReq({ secret: "wrong", header: "correct-secret-value-32-chars-aaa" });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(403);
  });

  it("403 if header missing (strict mode)", async () => {
    const { request, params } = mkReq({ secret: "correct-secret-value-32-chars-aaa" });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(403);
  });

  it("403 if header present but wrong", async () => {
    const { request, params } = mkReq({
      secret: "correct-secret-value-32-chars-aaa",
      header: "wrong-header-value-aaaaaaaaaaaaaa",
    });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(403);
  });

  it("200 if both secret and header match", async () => {
    const { request, params } = mkReq({
      secret: "correct-secret-value-32-chars-aaa",
      header: "correct-secret-value-32-chars-aaa",
      body: { update_id: 42, message: { text: "/saldo" } },
    });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run test, expect fail**

Run: `npx vitest run src/app/api/telegram/webhook/[secret]/route.test.ts`
Expected: 1 PASS (503 env-missing), 4 FAIL — current code allows missing-header bypass and uses `!==`.

(If file path with brackets confuses vitest, use single quotes: `npx vitest run "src/app/api/telegram/webhook/[secret]/route.test.ts"`)

- [ ] **Step 4: Apply hardened route**

Replace the body of `src/app/api/telegram/webhook/[secret]/route.ts` POST handler with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/telegram-handlers";
import { constantTimeEquals } from "@/lib/crypto-utils";
import type { TelegramUpdate } from "@/lib/telegram-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secret: string }> }
) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[telegram/webhook] TELEGRAM_WEBHOOK_SECRET non configurato");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const { secret } = await params;
  if (!constantTimeEquals(secret, expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Strict header mode: Telegram MUST send the secret_token header.
  // setWebhook is configured with secret_token (see /api/telegram/setup).
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!headerSecret || !constantTimeEquals(headerSecret, expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    await handleTelegramUpdate(update);
  } catch (err) {
    console.error("[telegram/webhook] handler error:", err);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `npx vitest run "src/app/api/telegram/webhook/[secret]/route.test.ts"`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add src/app/api/telegram/webhook/[secret]/route.ts src/app/api/telegram/webhook/[secret]/route.test.ts src/app/api/telegram/setup/route.ts
git commit -m "feat(security): Telegram webhook const-time + strict header (C4)

- Use constantTimeEquals for both URL secret and header secret
- Header secret is now REQUIRED (no more bypass when header missing)
- Verify /api/telegram/setup passes secret_token to Telegram setWebhook

Deploy note: after deploy, the existing webhook on Telegram side must have
been registered with secret_token. If not, call /api/telegram/setup again.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Register Zod + rate-limit + const-time + mask (C7)

**Files:**
- Modify: `src/app/api/register/route.ts`
- Create: `src/app/api/register/route.test.ts`
- Verify: `package.json` has `zod` dependency

- [ ] **Step 1: Verify zod dependency**

Run: `grep '"zod"' package.json`
Expected: line printed.

If missing: `npm install zod` and commit `package.json` + `package-lock.json` in this task's commit.

- [ ] **Step 2: Write failing integration test**

Create `src/app/api/register/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";
import { _resetBucketsForTest } from "@/lib/rate-limit";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

function mkReq(body: unknown, ip = "10.0.0.1"): Request {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/register", () => {
  beforeEach(() => {
    _resetBucketsForTest();
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.create).mockReset();
    process.env.SYSTEM_REGISTRATION_SECRET = "admin-secret-value-32-chars-aaaa";
  });

  it("400 on missing fields", async () => {
    const res = await POST(mkReq({}) as never);
    expect(res.status).toBe(400);
  });

  it("400 on invalid email", async () => {
    const res = await POST(mkReq({ email: "not-an-email", name: "Mario", password: "12345678" }) as never);
    expect(res.status).toBe(400);
  });

  it("400 on short password", async () => {
    const res = await POST(mkReq({ email: "a@epartner.it", name: "Mario", password: "short" }) as never);
    expect(res.status).toBe(400);
  });

  it("400 on name with HTML/script chars", async () => {
    const res = await POST(mkReq({
      email: "a@epartner.it",
      name: "<script>alert(1)</script>",
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(400);
  });

  it("400 on name too long", async () => {
    const res = await POST(mkReq({
      email: "a@epartner.it",
      name: "x".repeat(101),
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(400);
  });

  it("403 on disallowed domain (employee path)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await POST(mkReq({
      email: "mario@evil.com",
      name: "Mario Rossi",
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(403);
  });

  it("403 on wrong systemPassword (admin path)", async () => {
    const res = await POST(mkReq({
      email: "admin@evil.com",
      name: "Admin",
      password: "validpass123",
      systemPassword: "wrong-value-totally-different-aa",
    }) as never);
    expect(res.status).toBe(403);
  });

  it("202 mask on existing email (employee path)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "x" } as never);
    const res = await POST(mkReq({
      email: "exists@epartner.it",
      name: "Mario Rossi",
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(202);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("202 mask on new email (employee path)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "new", email: "new@epartner.it", name: "Mario Rossi", role: "EMPLOYEE", active: false,
    } as never);
    const res = await POST(mkReq({
      email: "new@epartner.it",
      name: "Mario Rossi",
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(202);
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it("201 detailed on admin reg (correct systemPassword)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "adm", email: "admin@anywhere.com", name: "Admin", role: "ADMIN", active: true,
    } as never);
    const res = await POST(mkReq({
      email: "admin@anywhere.com",
      name: "Admin",
      password: "validpass123",
      systemPassword: "admin-secret-value-32-chars-aaaa",
    }) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("ADMIN");
  });

  it("409 on existing email (admin path, no mask)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "x" } as never);
    const res = await POST(mkReq({
      email: "admin@anywhere.com",
      name: "Admin",
      password: "validpass123",
      systemPassword: "admin-secret-value-32-chars-aaaa",
    }) as never);
    expect(res.status).toBe(409);
  });

  it("429 after 5 hits in window (same IP)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "x", email: "x@epartner.it", name: "x", role: "EMPLOYEE", active: false,
    } as never);
    for (let i = 0; i < 5; i++) {
      await POST(mkReq({ email: `u${i}@epartner.it`, name: "User", password: "validpass123" }, "1.1.1.1") as never);
    }
    const res = await POST(mkReq({ email: "u6@epartner.it", name: "User", password: "validpass123" }, "1.1.1.1") as never);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test, expect fail**

Run: `npx vitest run src/app/api/register/route.test.ts`
Expected: most tests fail because current route lacks Zod/rate-limit/mask.

- [ ] **Step 4: Replace route**

Replace `src/app/api/register/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { constantTimeEquals } from "@/lib/crypto-utils";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const ALLOWED_DOMAINS = ["epartner.it"];

const RegisterSchema = z.object({
  email: z.string().email().max(200),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[\p{L}\p{N}\s'.-]+$/u, "name contains invalid characters"),
  password: z.string().min(8).max(128),
  systemPassword: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  // Rate limit by IP, 5 req / 15 min
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `register:${ip}`, max: 5, windowMs: 15 * 60_000 });
  if (!rl.ok) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 400 }
    );
  }
  const { email, name, password, systemPassword } = parsed.data;

  // Admin path: systemPassword present and matches (constant-time)
  const expectedAdminSecret = process.env.SYSTEM_REGISTRATION_SECRET ?? "";
  const isAdminRegistration =
    !!systemPassword &&
    expectedAdminSecret.length > 0 &&
    constantTimeEquals(systemPassword, expectedAdminSecret);

  if (systemPassword && !isAdminRegistration) {
    return NextResponse.json({ error: "Password di sistema non valida" }, { status: 403 });
  }

  // Employee path: enforce allowed domain
  if (!isAdminRegistration) {
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (!ALLOWED_DOMAINS.includes(domain)) {
      return NextResponse.json(
        { error: `La registrazione è consentita solo per indirizzi @${ALLOWED_DOMAINS.join(", @")}` },
        { status: 403 }
      );
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  // Admin path: real 409 on duplicate (caller is already authenticated by secret)
  if (isAdminRegistration && existing) {
    return NextResponse.json({ error: "Un utente con questa email esiste già" }, { status: 409 });
  }

  // Employee path: mask both "exists" and "created" with uniform 202 to prevent enumeration
  if (!isAdminRegistration && existing) {
    return NextResponse.json(
      { status: "accepted", message: "Registrazione ricevuta. Se l'indirizzo è valido riceverai una conferma." },
      { status: 202 }
    );
  }

  const passwordHash = await hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: isAdminRegistration ? "ADMIN" : "EMPLOYEE",
      active: isAdminRegistration ? true : false,
    },
  });

  if (isAdminRegistration) {
    return NextResponse.json(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { status: 201 }
    );
  }

  return NextResponse.json(
    { status: "accepted", message: "Registrazione ricevuta. Se l'indirizzo è valido riceverai una conferma." },
    { status: 202 }
  );
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `npx vitest run src/app/api/register/route.test.ts`
Expected: 12 passed

- [ ] **Step 6: Commit**

```bash
git add src/app/api/register/route.ts src/app/api/register/route.test.ts package.json package-lock.json
git commit -m "feat(security): /api/register hardening — Zod + rate-limit + mask (C7)

- Zod schema with strict name regex (no HTML chars), email/password limits
- Rate limit 5 req / 15 min per IP via shared helper
- constantTimeEquals for systemPassword
- Email enumeration mask: employee path returns uniform 202 whether
  email is new or already exists
- Admin path keeps real 409 (caller authenticated by secret)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: CSRF same-origin middleware (C3)

**Files:**
- Modify: `src/middleware.ts`
- Create: `src/middleware.test.ts`

Note: existing `config.matcher` already excludes `/api/auth`, `/api/register`, `/api/kiosk`, `/api/external`, `/api/employee-portal`, `/api/telegram/webhook`. The CSRF check therefore only runs for session-protected routes — no internal allowlist needed inside the middleware function.

- [ ] **Step 1: Write failing test**

Create `src/middleware.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: (handler: (req: { auth: unknown; nextUrl: URL; method: string; headers: Headers; url: string }) => unknown) => handler,
}));

// Re-import after mock so middleware uses the mocked auth wrapper
const { default: middleware } = await import("./middleware");

function mkReq(opts: {
  method: string;
  path: string;
  origin?: string;
  referer?: string;
  host?: string;
  auth?: unknown;
}) {
  const host = opts.host ?? "hr.epartner.it";
  const headers = new Headers({ host });
  if (opts.origin) headers.set("origin", opts.origin);
  if (opts.referer) headers.set("referer", opts.referer);
  const url = `https://${host}${opts.path}`;
  return {
    auth: opts.auth ?? { user: { active: true, role: "ADMIN" } },
    nextUrl: new URL(url),
    method: opts.method,
    headers,
    url,
  };
}

describe("CSRF middleware", () => {
  it("allows POST with same-origin Origin", async () => {
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
      origin: "https://hr.epartner.it",
    }) as never);
    // NextResponse.next() has no status override; not a Response with 403
    expect((res as Response).status).not.toBe(403);
  });

  it("blocks POST with cross-origin Origin", async () => {
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
      origin: "https://evil.com",
    }) as never);
    expect((res as Response).status).toBe(403);
  });

  it("falls back to Referer when Origin missing (same host = ok)", async () => {
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
      referer: "https://hr.epartner.it/leaves",
    }) as never);
    expect((res as Response).status).not.toBe(403);
  });

  it("blocks POST when both Origin and Referer missing", async () => {
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
    }) as never);
    expect((res as Response).status).toBe(403);
  });

  it("allows GET regardless of Origin", async () => {
    const res = await middleware(mkReq({
      method: "GET",
      path: "/api/leaves",
    }) as never);
    expect((res as Response).status).not.toBe(403);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npx vitest run src/middleware.test.ts`
Expected: 4 fail (CSRF logic not yet present), 1 pass (GET).

- [ ] **Step 3: Update middleware**

Edit `src/middleware.ts`. After the existing inactive-account check and before `return NextResponse.next();`, insert the CSRF block:

```ts
  // CSRF same-origin check on mutating requests.
  // Public routes (kiosk, external, telegram webhook, employee-portal, register,
  // NextAuth) are already excluded by config.matcher.
  const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (MUTATING_METHODS.has(req.method)) {
    const host = req.headers.get("host");
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");

    let allowed = false;
    if (origin) {
      try {
        allowed = new URL(origin).host === host;
      } catch {
        allowed = false;
      }
    } else if (referer) {
      try {
        allowed = new URL(referer).host === host;
      } catch {
        allowed = false;
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: "CSRF blocked" }, { status: 403 });
    }
  }
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run src/middleware.test.ts`
Expected: 5 passed

- [ ] **Step 5: Run full build, verify no regressions**

Run: `npx next build`
Expected: build OK.

- [ ] **Step 6: Smoke-test manually (optional but recommended)**

Start dev server: `npx next dev` (kill after test)
- Log in, click "Crea richiesta ferie" → POST `/api/leaves` should succeed
- From DevTools console: `fetch("/api/leaves", { method: "POST", headers: { origin: "https://evil.com" }, credentials: "include" })` → expect 403 (note: browser will overwrite `origin` to actual page origin, so a true cross-origin test requires curl or another tab)

- [ ] **Step 7: Commit**

```bash
git add src/middleware.ts src/middleware.test.ts
git commit -m "feat(security): CSRF same-origin check in middleware (C3)

POST/PUT/PATCH/DELETE require Origin or Referer header matching host.
Routes with own auth (kiosk, external, telegram webhook, employee-portal,
register, NextAuth) are already excluded by config.matcher.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: ESLint rule `no-iso-split` (C1 guard)

**Files:**
- Create: `eslint-rules/no-iso-split.js`
- Create: `eslint-rules/no-iso-split.test.js`
- Modify: `eslint.config.mjs` (or `.eslintrc.*`)

- [ ] **Step 1: Inspect existing ESLint config**

Run: `ls -la eslint.config.* .eslintrc.* 2>&1 | head`

Identify whether the project uses flat config (`eslint.config.mjs`) or legacy (`.eslintrc.json/.js`).

- [ ] **Step 2: Write failing rule test**

Create `eslint-rules/no-iso-split.test.js`:

```js
const { RuleTester } = require("eslint");
const rule = require("./no-iso-split");

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

tester.run("no-iso-split", rule, {
  valid: [
    { code: "const today = todayRome();" },
    { code: "const d = date.toISOString();" },
    { code: "const parts = str.split('-');" },
    {
      code: "const today = new Date().toISOString().split('T')[0];",
      filename: "src/lib/tz.ts",
    },
  ],
  invalid: [
    {
      code: "const today = new Date().toISOString().split('T')[0];",
      filename: "src/app/page.tsx",
      errors: [{ message: /todayRome\(\) from @\/lib\/tz/ }],
    },
    {
      code: "const s = d.toISOString().split('T')[0];",
      filename: "src/lib/foo.ts",
      errors: [{ message: /todayRome\(\) from @\/lib\/tz/ }],
    },
  ],
});

console.log("no-iso-split rule passes RuleTester");
```

- [ ] **Step 3: Run, expect fail**

Run: `node eslint-rules/no-iso-split.test.js`
Expected: FAIL — rule module missing.

- [ ] **Step 4: Implement rule**

Create `eslint-rules/no-iso-split.js`:

```js
"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid `.toISOString().split(...)` for date extraction. Use todayRome() from @/lib/tz.",
    },
    schema: [],
    messages: {
      useTodayRome: "Use todayRome() from @/lib/tz instead of .toISOString().split(...)",
    },
  },
  create(context) {
    const filename = (context.filename || context.getFilename() || "").replace(/\\/g, "/");
    if (filename.endsWith("/lib/tz.ts")) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee &&
          callee.type === "MemberExpression" &&
          callee.property &&
          callee.property.name === "split" &&
          callee.object &&
          callee.object.type === "CallExpression" &&
          callee.object.callee &&
          callee.object.callee.type === "MemberExpression" &&
          callee.object.callee.property &&
          callee.object.callee.property.name === "toISOString"
        ) {
          context.report({ node, messageId: "useTodayRome" });
        }
      },
    };
  },
};
```

- [ ] **Step 5: Run test, expect pass**

Run: `node eslint-rules/no-iso-split.test.js`
Expected: "no-iso-split rule passes RuleTester"

- [ ] **Step 6: Register rule in ESLint config**

**If `eslint.config.mjs` (flat config):**

Add an entry to the exported config array:

```js
import noIsoSplit from "./eslint-rules/no-iso-split.js";

export default [
  // ... existing entries ...
  {
    plugins: {
      local: { rules: { "no-iso-split": noIsoSplit } },
    },
    rules: {
      "local/no-iso-split": "error",
    },
  },
];
```

**If `.eslintrc.json` (legacy):**

Add to the `rules` section using `eslint-plugin-local-rules` (`npm i -D eslint-plugin-local-rules` if missing), or use the simpler `no-restricted-syntax`:

```json
"rules": {
  "no-restricted-syntax": [
    "error",
    {
      "selector": "CallExpression[callee.property.name='split'][callee.object.callee.property.name='toISOString']",
      "message": "Use todayRome() from @/lib/tz instead of .toISOString().split(...)"
    }
  ]
}
```

Pick the form matching the project's actual config style.

- [ ] **Step 7: Run lint, expect existing violations**

Run: `npm run lint 2>&1 | head -60`
Expected: the rule fires on the 13 Cat A+B sites we will fix in tasks 9–10.

This is the desired state: rule is active, violations are reported, next tasks will fix them.

- [ ] **Step 8: Commit (rule only, not yet replacing call sites)**

```bash
git add eslint-rules/no-iso-split.js eslint-rules/no-iso-split.test.js eslint.config.mjs .eslintrc.json package.json package-lock.json 2>/dev/null
git commit -m "feat(security): add no-iso-split ESLint rule (C1 guard)

Forbids .toISOString().split(...) outside src/lib/tz.ts. Next commits
will replace existing call sites with todayRome().

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Note: `npm run lint` will report errors until tasks 9–11 replace call sites. Build (`next build`) still passes because lint errors are not build-blocking unless configured to be.

---

## Task 9: TZ replace Cat A — server-side (C1)

**Files:**
- Modify: `src/lib/dashboard-helpers.ts:23,31,32,68,120`
- Modify: `src/app/api/anomalies/count/route.ts:9`
- Modify: `src/app/api/attendance/route.ts:28`
- Modify: `src/app/api/stats/dashboard/route.ts:57,58`

For each file: add `import { todayRome } from "@/lib/tz";` if not present, then replace `new Date().toISOString().split("T")[0]` (and the `prev.toISOString().split("T")[0]` variants where the Date is "now"-ish) with `todayRome()` / `todayRome(theDate)`.

- [ ] **Step 1: `src/lib/dashboard-helpers.ts`**

Read full file: `Read src/lib/dashboard-helpers.ts`.

Add at top of imports: `import { todayRome } from "./tz";`

Replace at line 23:
```ts
const today = now.toISOString().split("T")[0];
```
with
```ts
const today = todayRome(now);
```

At lines 31–32 (`yesterday.toISOString().split("T")[0]`): replace both with `todayRome(yesterday)`.

At line 68 (`cur.toISOString().split("T")[0]`): this is a Cat D loop iter site — leave it (deferred). Skip.

At line 120 (`cur.toISOString().split("T")[0]`): same — Cat D, leave it.

So in this file only lines 23, 31, 32 are touched.

- [ ] **Step 2: `src/app/api/anomalies/count/route.ts`**

Add `import { todayRome } from "@/lib/tz";`
Replace line 9 `const today = new Date().toISOString().split("T")[0];` with `const today = todayRome();`

- [ ] **Step 3: `src/app/api/attendance/route.ts`**

Add `import { todayRome } from "@/lib/tz";`
Replace line 28 `const today = new Date().toISOString().split("T")[0];` with `const today = todayRome();`

- [ ] **Step 4: `src/app/api/stats/dashboard/route.ts`**

Add `import { todayRome } from "@/lib/tz";`
Replace line 57: `const today = now.toISOString().split("T")[0];` → `const today = todayRome(now);`
Replace line 58: `const today14 = new Date(now.getTime() + 14 * 86400000).toISOString().split("T")[0];` → `const today14 = todayRome(new Date(now.getTime() + 14 * 86400000));`

Lines 430 and 447 in same file are Cat D loop iters — leave them.

- [ ] **Step 5: Build + lint**

Run: `npx next build`
Expected: build OK.

Run: `npm run lint 2>&1 | head -30`
Expected: violations in this file group are gone; only Cat B (client) + Cat C (hireDate) + Cat D (loops) remain.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard-helpers.ts src/app/api/anomalies/count/route.ts src/app/api/attendance/route.ts src/app/api/stats/dashboard/route.ts
git commit -m "fix(tz): replace UTC midnight with todayRome() in server now-sites (C1 Cat A)

Server-side endpoints serving 'today' data: dashboard, anomalies count,
attendance default, stats dashboard. Loop iter sites (Cat D) deferred.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: TZ replace Cat B — client-side (C1)

**Files:**
- Modify: `src/app/(dashboard)/anomalies/page.tsx:105,109`
- Modify: `src/app/(dashboard)/employees/[id]/page.tsx:154`
- Modify: `src/app/(dashboard)/leaves/_components/CalendarView.tsx:29`
- Modify: `src/app/(dashboard)/leaves/_components/GanttCalendar.tsx:169`
- Modify: `src/app/(dashboard)/page.tsx:166,167`
- Modify: `src/app/(dashboard)/records/page.tsx:65`
- Modify: `src/components/dashboard/AnomalyList.tsx:14,18`

Each file: add `import { todayRome } from "@/lib/tz";` and replace the `.toISOString().split("T")[0]` calls.

- [ ] **Step 1: Replace each file**

For each path above:
1. Read the file to confirm import block location and line offsets.
2. Add `import { todayRome } from "@/lib/tz";` to the import block.
3. For `new Date().toISOString().split("T")[0]` → `todayRome()`.
4. For `someDate.toISOString().split("T")[0]` where `someDate` is a `Date` (e.g., `yesterday` in `AnomalyList.tsx:18`) → `todayRome(someDate)`.

Specific notes:
- `anomalies/page.tsx:105`: `return d.toISOString().split("T")[0];` → `return todayRome(d);`
- `anomalies/page.tsx:109`: `return new Date().toISOString().split("T")[0];` → `return todayRome();`
- `AnomalyList.tsx:14`: `const today = new Date().toISOString().split("T")[0];` → `const today = todayRome();`
- `AnomalyList.tsx:18`: `if (dateStr === yesterday.toISOString().split("T")[0]) return "ieri";` → `if (dateStr === todayRome(yesterday)) return "ieri";`

- [ ] **Step 2: Build**

Run: `npx next build`
Expected: build OK.

- [ ] **Step 3: Lint**

Run: `npm run lint 2>&1 | head -30`
Expected: zero `no-iso-split` violations remaining for Cat B files. Only Cat C (hireDate, task 11) + Cat D (loops, deferred) may remain.

- [ ] **Step 4: Smoke (manual, local)**

Run: `npx next dev` (kill after).
Log in. Check that dashboard, anomalies, leaves calendar, employee detail, records pages render without console errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/anomalies/page.tsx src/app/\(dashboard\)/employees/\[id\]/page.tsx "src/app/(dashboard)/leaves/_components/CalendarView.tsx" "src/app/(dashboard)/leaves/_components/GanttCalendar.tsx" src/app/\(dashboard\)/page.tsx src/app/\(dashboard\)/records/page.tsx src/components/dashboard/AnomalyList.tsx
git commit -m "fix(tz): replace UTC midnight with todayRome() in client pages (C1 Cat B)

8 client-side files extracting 'today' for UI highlighting. Resolves
the off-by-one near midnight Europe/Rome.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

(If your shell complains about parentheses in paths, quote each path with double quotes instead.)

---

## Task 11: TZ replace Cat C — `hireDate` (C1)

**Files:**
- Modify: `src/app/api/employees/route.ts:101`
- Modify: `src/app/api/employees/[id]/route.ts:45,281`

Schema confirmed `hireDate DateTime?` (Prisma `DateTime`). Replace with `todayRome(date)`.

- [ ] **Step 1: Apply replacements**

In each file add `import { todayRome } from "@/lib/tz";`.

- `src/app/api/employees/route.ts:101`:
  ```ts
  hireDate: created.hireDate?.toISOString().split("T")[0] ?? null,
  ```
  →
  ```ts
  hireDate: created.hireDate ? todayRome(created.hireDate) : null,
  ```

- `src/app/api/employees/[id]/route.ts:45`:
  ```ts
  hireDate: employee.hireDate?.toISOString().split("T")[0] ?? null,
  ```
  →
  ```ts
  hireDate: employee.hireDate ? todayRome(employee.hireDate) : null,
  ```

- `src/app/api/employees/[id]/route.ts:281`: same pattern with `updated.hireDate`.

- [ ] **Step 2: Build + lint**

Run: `npx next build && npm run lint 2>&1 | head -30`
Expected: build OK. Only Cat D loop iter violations remain (these are deferred and acceptable; the rule still fires on them — see Step 3).

- [ ] **Step 3: Suppress Cat D loops with eslint-disable-next-line + TODO comment**

For each Cat D site (loop iters), add a line above the offending expression:

```ts
// eslint-disable-next-line local/no-iso-split -- TODO(C1-LOOPS-DEFERRED): verify UTC-midnight cur is intentional
```

Cat D sites:
- `src/lib/dashboard-helpers.ts:68`
- `src/lib/dashboard-helpers.ts:120`
- `src/app/api/stats/dashboard/route.ts:430`
- `src/app/api/stats/dashboard/route.ts:447`
- `src/app/api/export/route.ts:99`
- `src/lib/excel-presenze.ts:431`

(If the rule was registered via `no-restricted-syntax` instead of `local/no-iso-split`, use the appropriate disable comment for that rule name.)

- [ ] **Step 4: Lint clean**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/employees/route.ts src/app/api/employees/\[id\]/route.ts src/lib/dashboard-helpers.ts src/app/api/stats/dashboard/route.ts src/app/api/export/route.ts src/lib/excel-presenze.ts
git commit -m "fix(tz): hireDate display via todayRome + suppress Cat D loops (C1)

- Cat C: 3 hireDate sites now use todayRome(date) for correct serialization
- Cat D: 6 loop-iter sites marked with eslint-disable + TODO(C1-LOOPS-DEFERRED).
  Loop UTC-midnight cur arithmetic may be intentional; verify in follow-up.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Full verification gate

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass except the pre-existing `calculator pause-from-hours` failure documented in memory (`project_hr_leaves_domain`).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Run full build**

Run: `npx next build`
Expected: build OK, no new TS or lint errors.

- [ ] **Step 4: Manual smoke (local)**

Run: `npx next dev` and execute the 6 smoke-test points from the spec:
1. WS connect (Network → WS frame after login)
2. Telegram `/saldo` — verify webhook locally with ngrok OR defer to staging
3. Register employee `@epartner.it` → 202 + DB record inactive
4. Register same email again → 202 (uniforme)
5. CSRF block: from a separate origin (curl) `POST /api/leaves` with stolen cookie → 403
6. Dashboard at midnight Europe/Rome: hard to test locally — defer to post-deploy eyeball

Items 2 and 6 are deferred to staging/prod smoke.

Kill the dev server when done.

- [ ] **Step 5: Final commit (only if pending changes)**

If steps above produced fixups, commit them:

```bash
git status
git add -A
git commit -m "chore(security): final fixups after smoke verification

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Otherwise skip.

- [ ] **Step 6: Update memory**

After all tasks complete, update `memory/project_hr_tech_debt_tasklist.md`:
- Mark C1 (Cat A+B+C) ✅
- Mark C3 ✅
- Mark C4 ✅
- Mark C5 ✅
- Mark C7 ✅
- Mark H6 ✅
- Update "Stato gruppi" table: Gruppo 2 → DONE.
- Note Cat D as `C1-LOOPS-DEFERRED` follow-up.

- [ ] **Step 7: Deploy preparation**

Before triggering deploy:
1. Verify `WS_HOST=127.0.0.1` either committed as default or added to NSSM `AppEnvironmentExtra` on server.
2. Verify `setWebhook` was called with `secret_token` (call `/api/telegram/setup` once after deploy if uncertain).
3. Follow the standard build + zip + publish-server.ps1 flow from `project_hr_deploy_pipeline.md`.

Phase complete. Do NOT run deploy commands automatically; surface readiness to the user and let them trigger.
