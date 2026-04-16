# Monthly Presenze Report Worker — Design Spec

**Date:** 2026-04-16
**Author:** Stefano Brunelli (brainstormed with Claude)
**Status:** Draft — awaiting review

---

## 1. Goal

Automatically generate the monthly attendance report (Foglio Presenze .xlsx) and email it to opted-in admin users on a configurable day each month. The report covers the previous month (e.g., on the 5th of May, send the April report).

**Success criteria:**
1. On day X of each month, the worker generates the .xlsx for the previous month and emails it to all admins with `receiveMonthlyReport = true`.
2. The send day (1-28) is configurable from Settings.
3. The worker can be enabled/disabled from Settings.
4. If sending fails, one automatic retry after 1 hour. After that, log and give up — the report is always available for manual download.
5. A "Send now" button allows admin to trigger the report manually for testing.
6. No external scheduler — runs inside the Node process via the existing `setTimeout` polling pattern.

---

## 2. Schema changes

### 2.1 New `AppSetting` model

```prisma
model AppSetting {
  key   String @id
  value String
}
```

Generic key-value store for app-wide configuration. Used keys:

| Key | Default | Description |
|---|---|---|
| `monthlyReportDay` | `"5"` | Day of month (1-28) to send the report |
| `monthlyReportEnabled` | `"true"` | `"true"` or `"false"` — master on/off |
| `lastReportSent` | `""` | `"YYYY-MM"` — prevents double-send in the same month |

### 2.2 `User.receiveMonthlyReport`

```prisma
model User {
  // ... existing ...
  receiveMonthlyReport Boolean @default(true)
}
```

Independent from `receiveLeaveNotifications`. Toggle visible in Settings → Utenti for admin rows.

---

## 3. Worker

### 3.1 File: `src/lib/monthly-report-worker.ts`

**Same pattern as `mail-ingest.ts`:** `setTimeout` recursion, singleton via module-level `_running` flag.

```
ensureMonthlyReportWorkerStarted()
  → scheduleNext(0)  // immediate first check
    → runCheck()
      → if not enabled → skip
      → if today.getDate() !== configuredDay → skip
      → if lastReportSent === currentYearMonth → skip
      → generateAndSend()
        → on success: write lastReportSent
        → on error: log, schedule retry in 1h (once)
    → scheduleNext(CHECK_INTERVAL_MS)  // 1 hour = 3_600_000
```

### 3.2 `generateAndSend()` flow

1. Compute previous month: if today is May 2026, previous = April 2026.
2. Build `PresenzeMonthData` for that month (reuse the same data-fetching logic that the `/api/export/presenze` route uses — extract it into a shared function if needed, or call the existing `generatePresenzeXlsx` with the right data).
3. Call `generatePresenzeXlsx(data)` → `Buffer`.
4. Query admins: `prisma.user.findMany({ where: { role: "ADMIN", active: true, receiveMonthlyReport: true } })`.
5. For each admin with non-null email: call `sendMail` with the .xlsx as attachment.
6. On success: `prisma.appSetting.upsert({ where: { key: "lastReportSent" }, create: { key: "lastReportSent", value: "2026-05" }, update: { value: "2026-05" } })`.

### 3.3 Retry logic

If `generateAndSend()` throws:
- `console.error("[monthly-report] failed:", err)`
- If this is the first attempt for this month: set a flag `_retryScheduled = true`, schedule `runCheck()` again in 1 hour
- If retry also fails: log and give up. `_retryScheduled` resets at next month.

### 3.4 Boot

**File:** `src/instrumentation.ts` (or wherever the mail poller is started)

Add:
```ts
import { ensureMonthlyReportWorkerStarted } from "./lib/monthly-report-worker";
ensureMonthlyReportWorkerStarted();
```

---

## 4. `sendMail` attachment support

### 4.1 `SendMailArgs` extension

```ts
export interface MailAttachment {
  filename: string;
  contentBytes: string; // base64-encoded
  contentType: string;  // MIME type
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

### 4.2 Graph API payload

In `sendMailGraph`, when `args.attachments` is present, add to the `message` object:

```ts
attachments: args.attachments?.map(a => ({
  "@odata.type": "#microsoft.graph.fileAttachment",
  name: a.filename,
  contentType: a.contentType,
  contentBytes: a.contentBytes,
}))
```

The Graph API `/sendMail` endpoint natively supports `fileAttachment` with base64 content.

---

## 5. Email template

### New template: `monthlyReportEmail`

```ts
export function monthlyReportEmail(args: {
  monthLabel: string;  // "Aprile 2026"
  filename: string;    // "presenze_aprile_2026.xlsx"
}): MailReply
```

- Subject: `"Report presenze {monthLabel}"`
- HTML body: "In allegato il foglio presenze di **{monthLabel}**." + brief note "Il file è in formato Excel (.xlsx) e contiene il riepilogo giornaliero di tutti i dipendenti." No CTA button (the file is attached, no need to link to the platform).
- Text fallback: same content plain.

---

## 6. Shared data-fetching for Presenze

The existing `/api/export/presenze/route.ts` builds the `PresenzeMonthData` inline in its GET handler. The worker needs the same data. Extract the data-building logic into a shared function:

**File:** `src/lib/excel-presenze.ts` (add to existing file)

```ts
export async function buildPresenzeMonthData(year: number, month: number): Promise<PresenzeMonthData>
```

Moves the data-fetching logic (employees + records + schedules + holidays for that month) out of the route handler into this reusable function. The route handler then calls it too.

---

## 7. API endpoints

### 7.1 `GET /api/settings/monthly-report`

Returns current config:
```json
{ "day": 5, "enabled": true }
```

### 7.2 `PUT /api/settings/monthly-report`

Accepts `{ day: number, enabled: boolean }`. Validates day 1-28. Upserts `AppSetting` rows.

### 7.3 `POST /api/settings/monthly-report/send-now`

Manually triggers the report for the previous month. Calls `generateAndSend()` directly. Returns `{ ok: true, sentTo: number }` or error.

All three gated by `checkAuth()` (admin only).

---

## 8. UI

### 8.1 Settings hub card

New card in `/settings`:
- Icon: `CalendarCog` or `FileClockIcon` (from lucide)
- Title: "Report automatico presenze"
- Description: "Invio mensile del foglio presenze agli amministratori"
- Links to `/settings/monthly-report`

### 8.2 `/settings/monthly-report` page

Minimal page:

```
← Impostazioni

📊 Report automatico presenze

Invia automaticamente il foglio presenze del mese precedente
agli amministratori abilitati, il giorno scelto di ogni mese.

┌─────────────────────────────────────┐
│ Attivo          [toggle ON/OFF]     │
│ Giorno del mese [input 1-28] [5]   │
│                          [Salva]    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Test invio                          │
│ Genera e invia il report del mese   │
│ precedente a tutti gli admin        │
│ abilitati.        [Invia ora]       │
└─────────────────────────────────────┘
```

### 8.3 Settings → Utenti

New toggle column "Report mensile" for admin rows, same pattern as "Notifiche ferie":
- Checkbox bound to `user.receiveMonthlyReport`
- PATCH to `/api/settings/users` (already supports arbitrary field updates after Task 9)

---

## 9. Non-goals

- No import automation (payroll PDF remains manual)
- No DB-persisted send history (console log only)
- No per-admin schedule customization (single global day)
- No retry beyond one attempt
- No external scheduler (Windows Task Scheduler, cron)
- No multiple reports per month (only previous month)
- No PDF format (Excel .xlsx only, matching existing export)
