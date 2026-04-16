# Monthly Report Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate the monthly Foglio Presenze .xlsx and email it to opted-in admins on a configurable day each month, using the existing `setTimeout` polling pattern.

**Architecture:** New `AppSetting` model for global config + `User.receiveMonthlyReport` flag. Extract presenze data-building into a shared function from the existing export route. Add attachment support to `sendMailGraph`. Worker uses hourly `setTimeout` recursion (same as mail-ingest), started from `instrumentation.ts`. Settings UI page for day picker + enable/disable + send-now.

**Tech Stack:** Next.js 16, Prisma 6 + SQLite, ExcelJS, Microsoft Graph API (fileAttachment), Tailwind 4.

**Spec:** [docs/superpowers/specs/2026-04-16-monthly-report-worker-design.md](../specs/2026-04-16-monthly-report-worker-design.md)

---

## File map

**Schema:**
- Modify: `prisma/schema.prisma` — add `AppSetting` model + `User.receiveMonthlyReport`

**Library:**
- Modify: `src/lib/mail-send.ts` — add `attachments` to `SendMailArgs`
- Modify: `src/lib/mail-graph.ts` — pass attachments to Graph API
- Modify: `src/lib/excel-presenze.ts` — extract `buildPresenzeMonthData()` from route
- Modify: `src/lib/mail-templates.ts` — add `monthlyReportEmail` template
- Create: `src/lib/monthly-report-worker.ts` — the worker

**API:**
- Modify: `src/app/api/export/presenze/route.ts` — use extracted `buildPresenzeMonthData()`
- Create: `src/app/api/settings/monthly-report/route.ts` — GET/PUT config
- Create: `src/app/api/settings/monthly-report/send-now/route.ts` — manual trigger
- Modify: `src/app/api/settings/users/route.ts` — expose `receiveMonthlyReport`

**UI:**
- Create: `src/app/(dashboard)/settings/monthly-report/page.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx` — add hub card
- Modify: `src/app/(dashboard)/settings/users/page.tsx` — add toggle column

**Boot:**
- Modify: `src/instrumentation.ts` — start the worker

---

### Task 1: Schema — `AppSetting` + `User.receiveMonthlyReport`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `AppSetting` model**

Append at the end of the schema:

```prisma
model AppSetting {
  key   String @id
  value String
}
```

- [ ] **Step 2: Add `receiveMonthlyReport` to `User`**

In the `User` model, after `receiveLeaveNotifications`, add:

```prisma
  receiveMonthlyReport         Boolean @default(true)
```

- [ ] **Step 3: Run db:push + generate**

Run: `npm run db:push` (accept data loss if prompted).
Run: `npx prisma generate`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): AppSetting model + User.receiveMonthlyReport"
```

---

### Task 2: Email attachment support

**Files:**
- Modify: `src/lib/mail-send.ts`
- Modify: `src/lib/mail-graph.ts`

- [ ] **Step 1: Extend `SendMailArgs` in `mail-send.ts`**

Read the file. Add to the interface:

```ts
export interface MailAttachment {
  filename: string;
  contentBytes: string; // base64-encoded
  contentType: string;
}

export interface SendMailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyToMessageId?: string;
  attachments?: MailAttachment[];
}
```

- [ ] **Step 2: Pass attachments through in `sendMailGraph`**

Read `src/lib/mail-graph.ts`. In the `sendMailGraph` function, find where `const message = { ... }` is built (around line 261). Add the attachments field:

```ts
const message = {
  subject: args.subject,
  body: { ... },
  toRecipients: [{ ... }],
  ...(fromName ? { from: ... } : {}),
  ...(args.attachments?.length ? {
    attachments: args.attachments.map(a => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.filename,
      contentType: a.contentType,
      contentBytes: a.contentBytes,
    })),
  } : {}),
};
```

Also import the `MailAttachment` type if needed, or add `attachments` to the local `SendMailArgs` type that `sendMailGraph` uses. Check if `mail-graph.ts` imports from `mail-send.ts` or has its own type — update accordingly.

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/mail-send.ts src/lib/mail-graph.ts
git commit -m "feat(email): sendMail attachment support via Graph fileAttachment"
```

---

### Task 3: Extract `buildPresenzeMonthData` from export route

**Files:**
- Modify: `src/lib/excel-presenze.ts`
- Modify: `src/app/api/export/presenze/route.ts`

- [ ] **Step 1: Move data-building logic to `excel-presenze.ts`**

Read `src/app/api/export/presenze/route.ts` (the full file — 244 lines). Lines 60-233 contain all the data-fetching and mapping logic. Extract it into a new exported async function in `src/lib/excel-presenze.ts`.

Add at the bottom of `src/lib/excel-presenze.ts`:

```ts
import { prisma } from "./db";
import { getDayOfWeek } from "./date-utils";
import { calculateDailyStats, type DailyRecord, type EmployeeScheduleDay } from "./calculator";

const FULL_DAY_LEAVE_TYPES = new Set(["VACATION", "SICK", "BEREAVEMENT", "MARRIAGE", "LAW_104"]);
const HALF_DAY_LEAVE_TYPES = new Set(["VACATION_HALF_AM", "VACATION_HALF_PM"]);

export async function buildPresenzeMonthData(year: number, month: number): Promise<PresenzeMonthData> {
  const monthStr = String(month).padStart(2, "0");
  const yearStr = String(year);
  const nDays = new Date(year, month, 0).getDate();
  const from = `${yearStr}-${monthStr}-01`;
  const to = `${yearStr}-${monthStr}-${String(nDays).padStart(2, "0")}`;

  const employees = await prisma.employee.findMany({ orderBy: { name: "asc" } });
  const records = await prisma.attendanceRecord.findMany({
    where: { date: { gte: from, lte: to } },
    include: { employee: true },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });
  const schedules = await prisma.employeeSchedule.findMany();
  const scheduleMap = new Map<string, Map<number, EmployeeScheduleDay>>();
  for (const s of schedules) {
    if (!scheduleMap.has(s.employeeId)) scheduleMap.set(s.employeeId, new Map());
    scheduleMap.get(s.employeeId)!.set(s.dayOfWeek, {
      block1Start: s.block1Start, block1End: s.block1End,
      block2Start: s.block2Start, block2End: s.block2End,
    });
  }

  const leaves = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
  });
  type LeaveInfo = { type: string; hours: number | null };
  const leaveMap = new Map<string, LeaveInfo>();
  for (const l of leaves) {
    const start = l.startDate < from ? from : l.startDate;
    const end = l.endDate > to ? to : l.endDate;
    const cur = new Date(start);
    const endDate = new Date(end);
    while (cur <= endDate) {
      const dateStr = cur.toISOString().split("T")[0];
      const key = `${l.employeeId}|${dateStr}`;
      if (!leaveMap.has(key)) leaveMap.set(key, { type: l.type, hours: l.hours ?? null });
      cur.setDate(cur.getDate() + 1);
    }
  }

  const grouped = new Map<string, DailyRecord>();
  for (const r of records) {
    const key = `${r.employeeId}-${r.date}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        employeeId: r.employeeId,
        employeeName: r.employee.displayName || r.employee.name,
        date: r.date,
        records: [],
      });
    }
    grouped.get(key)!.records.push({
      type: r.type as DailyRecord["records"][0]["type"],
      declaredTime: r.declaredTime,
      messageTime: r.messageTime,
    });
  }

  const hoursMap = new Map<string, number>();
  for (const dr of grouped.values()) {
    const dayOfWeek = getDayOfWeek(dr.date);
    const empSchedule = scheduleMap.get(dr.employeeId)?.get(dayOfWeek) ?? null;
    const stats = calculateDailyStats(dr, empSchedule);
    hoursMap.set(`${dr.employeeId}|${dr.date}`, stats.hoursWorked);
  }

  const presenzeEmployees: PresenzeEmployeeData[] = [];
  for (const emp of employees) {
    const days = new Map<number, PresenzeDayData>();
    let buoniPasto = 0;
    for (let d = 1; d <= nDays; d++) {
      const dateStr = `${yearStr}-${monthStr}-${String(d).padStart(2, "0")}`;
      const hoursWorked = hoursMap.get(`${emp.id}|${dateStr}`) ?? 0;
      const leave = leaveMap.get(`${emp.id}|${dateStr}`);
      if (hoursWorked >= 6) buoniPasto++;
      let oreOrdinario: number | null = null;
      let oreFuoriSede: number | null = null;
      if (leave) {
        if (FULL_DAY_LEAVE_TYPES.has(leave.type)) {
          oreOrdinario = null;
          oreFuoriSede = 8;
        } else if (HALF_DAY_LEAVE_TYPES.has(leave.type)) {
          oreOrdinario = hoursWorked > 0 ? Math.round(hoursWorked) : null;
          oreFuoriSede = 4;
        } else {
          const leaveHours = leave.hours ?? 0;
          oreOrdinario = hoursWorked > 0 ? Math.round(hoursWorked) : null;
          oreFuoriSede = leaveHours > 0 ? Math.round(leaveHours) : null;
        }
      } else if (hoursWorked > 0) {
        oreOrdinario = Math.round(hoursWorked);
      }
      if (oreOrdinario !== null || oreFuoriSede !== null) {
        days.set(d, { oreOrdinario, oreFuoriSede });
      }
    }
    presenzeEmployees.push({
      displayName: (emp.displayName || emp.name).toUpperCase(),
      days,
      buoniPasto,
    });
  }
  presenzeEmployees.sort((a, b) => a.displayName.split(" ")[0].localeCompare(b.displayName.split(" ")[0]));

  return { year, month, employees: presenzeEmployees };
}
```

- [ ] **Step 2: Simplify the export route**

Replace the entire body of the GET handler in `src/app/api/export/presenze/route.ts` (from after the month validation to before the response) with:

```ts
  const data = await buildPresenzeMonthData(year, month);
  const buf = await generatePresenzeXlsx(data);

  return new NextResponse(buf as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${presenzeFilename(year, month)}"`,
    },
  });
```

Update imports to include `buildPresenzeMonthData` from `@/lib/excel-presenze` and remove the no-longer-needed imports (`prisma`, `calculateDailyStats`, `DailyRecord`, `EmployeeScheduleDay`, `getDayOfWeek`).

- [ ] **Step 3: Type-check + tests**

Run: `npx tsc --noEmit` — clean.
Run: `npx vitest run` — all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/excel-presenze.ts src/app/api/export/presenze/route.ts
git commit -m "refactor(excel): extract buildPresenzeMonthData into shared function"
```

---

### Task 4: Email template + worker

**Files:**
- Modify: `src/lib/mail-templates.ts` — add `monthlyReportEmail`
- Create: `src/lib/monthly-report-worker.ts`

- [ ] **Step 1: Add template**

In `src/lib/mail-templates.ts`, add:

```ts
/** Email per il report presenze mensile automatico (con allegato .xlsx). */
export function monthlyReportEmail(args: {
  monthLabel: string;
  filename: string;
}): MailReply {
  const subject = `Report presenze ${args.monthLabel}`;
  const text =
    `In allegato il foglio presenze di ${args.monthLabel}.\n\n` +
    `Il file "${args.filename}" è in formato Excel (.xlsx) e contiene ` +
    `il riepilogo giornaliero di tutti i dipendenti.` +
    FOOTER;
  const html = renderEmailHtml(
    `<p>In allegato il foglio presenze di <strong>${args.monthLabel}</strong>.</p>` +
    `<p>Il file <strong>${args.filename}</strong> è in formato Excel (.xlsx) e contiene ` +
    `il riepilogo giornaliero di tutti i dipendenti.</p>`
  );
  return { subject, text, html };
}
```

- [ ] **Step 2: Create the worker**

Create `src/lib/monthly-report-worker.ts`:

```ts
import { prisma } from "./db";
import { sendMail } from "./mail-send";
import { monthlyReportEmail } from "./mail-templates";
import { buildPresenzeMonthData, generatePresenzeXlsx, presenzeFilename } from "./excel-presenze";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MESI_LABEL = [
  "", "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

let _running = false;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _retryScheduled = false;

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function generateAndSend(): Promise<number> {
  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-12
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const monthLabel = `${MESI_LABEL[prevMonth]} ${prevYear}`;
  const filename = presenzeFilename(prevYear, prevMonth);

  console.log(`[monthly-report] Generating report for ${monthLabel}...`);

  const data = await buildPresenzeMonthData(prevYear, prevMonth);
  const buf = await generatePresenzeXlsx(data);
  const base64 = Buffer.from(buf).toString("base64");

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", active: true, receiveMonthlyReport: true },
    select: { email: true, name: true },
  });

  const template = monthlyReportEmail({ monthLabel, filename });
  let sentCount = 0;

  for (const admin of admins) {
    if (!admin.email) continue;
    try {
      const ok = await sendMail({
        to: admin.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
        attachments: [{
          filename,
          contentBytes: base64,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }],
      });
      if (ok) sentCount++;
      else console.warn(`[monthly-report] sendMail returned false for ${admin.email}`);
    } catch (err) {
      console.error(`[monthly-report] sendMail failed for ${admin.email}:`, err);
    }
  }

  console.log(`[monthly-report] Sent ${monthLabel} report to ${sentCount}/${admins.length} admins`);
  return sentCount;
}

async function runCheck(): Promise<void> {
  try {
    const enabled = await getSetting("monthlyReportEnabled");
    if (enabled === "false") return;

    const dayStr = await getSetting("monthlyReportDay");
    const day = dayStr ? parseInt(dayStr, 10) : 5;
    const now = new Date();

    if (now.getDate() !== day) return;

    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lastSent = await getSetting("lastReportSent");
    if (lastSent === currentYearMonth) return;

    await generateAndSend();
    await setSetting("lastReportSent", currentYearMonth);
    _retryScheduled = false;
  } catch (err) {
    console.error("[monthly-report] runCheck failed:", err);
    if (!_retryScheduled) {
      _retryScheduled = true;
      console.log("[monthly-report] Scheduling retry in 1 hour");
      setTimeout(() => {
        _retryScheduled = false;
        void runCheck().then(() => {
          const now = new Date();
          const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          return setSetting("lastReportSent", ym);
        }).catch((e) => console.error("[monthly-report] retry also failed:", e));
      }, CHECK_INTERVAL_MS);
    }
  }
}

function scheduleNext(delayMs: number): void {
  _timer = setTimeout(async () => {
    await runCheck();
    scheduleNext(CHECK_INTERVAL_MS);
  }, delayMs);
  if (_timer && typeof _timer === "object" && "unref" in _timer) {
    (_timer as NodeJS.Timeout).unref();
  }
}

export function ensureMonthlyReportWorkerStarted(): void {
  if (_running) return;
  _running = true;
  console.log("[monthly-report] Worker started (check every 1h)");
  scheduleNext(5000); // first check 5s after boot
}

/** Manual trigger — used by the "Send now" API. */
export async function triggerMonthlyReportNow(): Promise<number> {
  return generateAndSend();
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` — clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mail-templates.ts src/lib/monthly-report-worker.ts
git commit -m "feat(worker): monthly report worker + monthlyReportEmail template"
```

---

### Task 5: Boot the worker from `instrumentation.ts`

**Files:**
- Modify: `src/instrumentation.ts`

- [ ] **Step 1: Add worker startup**

After the existing `startWsNotificationServer()` call, add:

```ts
  // Monthly presenze report worker (hourly check)
  const { ensureMonthlyReportWorkerStarted } = await import("./lib/monthly-report-worker");
  ensureMonthlyReportWorkerStarted();
```

- [ ] **Step 2: Commit**

```bash
git add src/instrumentation.ts
git commit -m "feat(boot): start monthly report worker from instrumentation"
```

---

### Task 6: API endpoints for config + send-now

**Files:**
- Create: `src/app/api/settings/monthly-report/route.ts`
- Create: `src/app/api/settings/monthly-report/send-now/route.ts`

- [ ] **Step 1: Config GET/PUT endpoint**

Create `src/app/api/settings/monthly-report/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const dayRow = await prisma.appSetting.findUnique({ where: { key: "monthlyReportDay" } });
  const enabledRow = await prisma.appSetting.findUnique({ where: { key: "monthlyReportEnabled" } });

  return NextResponse.json({
    day: dayRow ? parseInt(dayRow.value, 10) : 5,
    enabled: enabledRow ? enabledRow.value !== "false" : true,
  });
}

export async function PUT(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { day, enabled } = body as { day?: number; enabled?: boolean };

  if (day !== undefined) {
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      return NextResponse.json({ error: "Giorno non valido (1-28)" }, { status: 400 });
    }
    await prisma.appSetting.upsert({
      where: { key: "monthlyReportDay" },
      create: { key: "monthlyReportDay", value: String(day) },
      update: { value: String(day) },
    });
  }

  if (typeof enabled === "boolean") {
    await prisma.appSetting.upsert({
      where: { key: "monthlyReportEnabled" },
      create: { key: "monthlyReportEnabled", value: String(enabled) },
      update: { value: String(enabled) },
    });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Send-now endpoint**

Create `src/app/api/settings/monthly-report/send-now/route.ts`:

```ts
import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { triggerMonthlyReportNow } from "@/lib/monthly-report-worker";

export async function POST() {
  const denied = await checkAuth();
  if (denied) return denied;

  try {
    const sentTo = await triggerMonthlyReportNow();
    return NextResponse.json({ ok: true, sentTo });
  } catch (err) {
    console.error("[monthly-report/send-now]", err);
    const msg = err instanceof Error ? err.message : "Errore invio report";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add src/app/api/settings/monthly-report/
git commit -m "feat(api): monthly-report config GET/PUT + send-now trigger"
```

---

### Task 7: Settings UI — monthly-report page + hub card

**Files:**
- Create: `src/app/(dashboard)/settings/monthly-report/page.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Create the settings page**

Create `src/app/(dashboard)/settings/monthly-report/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";

export default function MonthlyReportSettingsPage() {
  const confirm = useConfirm();
  const [day, setDay] = useState(5);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/settings/monthly-report")
      .then((r) => r.json())
      .then((data: { day: number; enabled: boolean }) => {
        setDay(data.day);
        setEnabled(data.enabled);
      })
      .catch(() => toast.error("Errore caricamento configurazione"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    const res = await fetch("/api/settings/monthly-report", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, enabled }),
    });
    if (res.ok) toast.success("Configurazione salvata");
    else toast.error("Errore nel salvataggio");
  }

  async function handleSendNow() {
    const ok = await confirm({
      title: "Invia report ora",
      message: "Genera e invia il foglio presenze del mese precedente a tutti gli amministratori abilitati. Procedere?",
      confirmLabel: "Invia ora",
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await fetch("/api/settings/monthly-report/send-now", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Report inviato a ${data.sentTo} amministratori`);
      } else {
        toast.error(data.error ?? "Errore invio report");
      }
    } finally {
      setSending(false);
    }
  }

  if (loading) return <p className="p-6 text-sm text-on-surface-variant">Caricamento…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/settings" className="text-sm text-primary hover:text-primary-container">
          ← Impostazioni
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-7 w-7 text-primary" strokeWidth={1.5} />
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">
          Report automatico presenze
        </h1>
      </div>
      <p className="text-sm text-on-surface-variant">
        Invia automaticamente il foglio presenze del mese precedente
        agli amministratori abilitati, il giorno scelto di ogni mese.
      </p>

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <label htmlFor="enabled" className="text-sm font-semibold text-on-surface">
            Invio automatico attivo
          </label>
          <input
            id="enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-5 w-5 rounded border-outline-variant text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </div>
        <div>
          <label htmlFor="day" className="block text-sm font-semibold text-on-surface mb-1">
            Giorno del mese
          </label>
          <input
            id="day"
            type="number"
            min={1}
            max={28}
            value={day}
            onChange={(e) => setDay(Math.max(1, Math.min(28, parseInt(e.target.value) || 1)))}
            className="w-24 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <p className="mt-1 text-xs text-on-surface-variant">
            Il report del mese precedente verrà generato e inviato il giorno indicato.
          </p>
        </div>
        <button
          onClick={handleSave}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary-container shadow-card transition-shadow hover:shadow-elevated"
        >
          Salva
        </button>
      </div>

      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card space-y-3">
        <h3 className="text-sm font-semibold text-on-surface">Test invio</h3>
        <p className="text-xs text-on-surface-variant">
          Genera e invia il report del mese precedente a tutti gli admin abilitati.
          Utile per verificare che email e allegato funzionino correttamente.
        </p>
        <button
          onClick={handleSendNow}
          disabled={sending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary-container shadow-card transition-shadow hover:shadow-elevated disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Invio in corso…" : "Invia ora"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add hub card in Settings page**

Read `src/app/(dashboard)/settings/page.tsx`. Add a new card (same pattern as existing cards). Import `FileClockIcon` or `CalendarCog` from lucide (or reuse `FileSpreadsheet`). Add:

```tsx
{
  href: "/settings/monthly-report",
  title: "Report automatico",
  description: "Invio mensile del foglio presenze agli amministratori",
  icon: FileSpreadsheet, // or CalendarCog
  color: "text-primary",
}
```

Match the exact card pattern used by other entries.

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add "src/app/(dashboard)/settings/monthly-report/page.tsx" "src/app/(dashboard)/settings/page.tsx"
git commit -m "feat(ui): monthly report settings page + hub card"
```

---

### Task 8: Settings → Utenti — `receiveMonthlyReport` toggle

**Files:**
- Modify: `src/app/(dashboard)/settings/users/page.tsx`
- Modify: `src/app/api/settings/users/route.ts`

- [ ] **Step 1: Add `receiveMonthlyReport` to `ActiveUser` interface**

In the users page, add to the interface:

```ts
receiveMonthlyReport: boolean;
```

- [ ] **Step 2: Add toggle in admin rows**

Find the existing "Notifiche ferie" checkbox (added in the previous feature). Right after it, add:

```tsx
<label className="inline-flex items-center gap-1.5 cursor-pointer">
  <input
    type="checkbox"
    checked={u.receiveMonthlyReport}
    onChange={() => handleToggleMonthlyReport(u.id, !u.receiveMonthlyReport)}
    className="h-4 w-4 rounded border-outline-variant text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
  />
  <span className="text-xs text-on-surface-variant">Report mensile</span>
</label>
```

- [ ] **Step 3: Add handler**

```ts
async function handleToggleMonthlyReport(userId: string, value: boolean) {
  const res = await fetch("/api/settings/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, receiveMonthlyReport: value }),
  });
  if (res.ok) {
    toast.success(value ? "Report mensile attivato" : "Report mensile disattivato");
    loadAll();
  } else {
    toast.error("Errore nell'aggiornamento");
  }
}
```

- [ ] **Step 4: Update API to handle `receiveMonthlyReport`**

In `src/app/api/settings/users/route.ts`:
- GET: add `receiveMonthlyReport: true` to the Prisma select, and include it in the response mapping.
- PATCH: add `receiveMonthlyReport` to the accepted fields (same pattern as `receiveLeaveNotifications`).

- [ ] **Step 5: Type-check + tests + commit**

Run: `npx tsc --noEmit` — clean.
Run: `npx vitest run` — all pass.

```bash
git add "src/app/(dashboard)/settings/users/page.tsx" "src/app/api/settings/users/route.ts"
git commit -m "feat(ui): receiveMonthlyReport toggle on Settings → Utenti"
```

---

### Task 9: Full verification

- [ ] **Step 1: Tests + type-check**

Run: `npx tsc --noEmit` — clean.
Run: `npx vitest run` — all pass.

- [ ] **Step 2: Manual — settings page**

Start dev server. Navigate to `/settings` → "Report automatico" card → open page. Verify:
- Day input (default 5) saves correctly
- Enable/disable toggle works
- "Invia ora" generates the report (if Graph configured → email arrives; if not → check console for `[monthly-report]` logs)

- [ ] **Step 3: Manual — Settings → Utenti**

Check the "Report mensile" checkbox appears for admin rows.

- [ ] **Step 4: Manual — worker boot**

Check dev server console output for `[monthly-report] Worker started (check every 1h)` at startup.

---

## Done

9 tasks: schema → attachments → extract shared data builder → worker + template → boot → APIs → settings UI → users toggle → verification.
