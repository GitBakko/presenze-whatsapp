# Email Templates + Leave Notifications + Sidebar Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand emails as HTML with ePartner HR base template, notify admins (email + in-app) on pending leave requests with opt-out toggle, add anomaly count badge to sidebar, and fix the active-item border to flush right.

**Architecture:** Sub-project A (template system) is pure lib code. Sub-project B (notification pipeline) extends the leaves API POST with fire-and-forget admin notifications and adds `LEAVE_PENDING` to the notification bus. Sub-project C (sidebar) adds one lightweight API endpoint + CSS fix.

**Tech Stack:** Next.js 16, Prisma 6 + SQLite, Microsoft Graph API for email, WebSocket notification bus, Tailwind 4, lucide-react.

**Spec:** [docs/superpowers/specs/2026-04-16-email-notifications-sidebar-design.md](../specs/2026-04-16-email-notifications-sidebar-design.md)

---

## File map

**Sub-project A — Email templates:**
- Modify: `src/lib/mail-templates.ts` — add `renderEmailHtml()`, `renderButton()`, convert 5 templates + add `newPendingLeaveNotification`
- Modify: `src/lib/mail-send.ts` — accept `html` field, pass to Graph as HTML content
- Modify: `src/lib/mail-graph.ts` — update `sendMailGraph` to support HTML contentType
- Create: `src/lib/mail-templates.test.ts` — unit tests for base template + new pending template

**Sub-project B — Notification pipeline:**
- Modify: `prisma/schema.prisma` — add `User.receiveLeaveNotifications`
- Create: `src/lib/leave-notifications.ts` — `notifyAdminsOfPendingLeave()` function
- Modify: `src/app/api/leaves/route.ts` — call notification after PENDING leave creation
- Modify: `src/lib/notifications-bus.ts` — add `LEAVE_PENDING` to `NotificationAction`
- Modify: `src/lib/useNotifications.ts` — add `LEAVE_PENDING` to client-side type + labels
- Modify: `src/components/NotificationBell.tsx` — add `LEAVE_PENDING` icon + label format
- Modify: `src/app/(dashboard)/settings/users/page.tsx` — add toggle column for admins
- Modify: `src/app/api/settings/users/route.ts` — accept `receiveLeaveNotifications` field

**Sub-project C — Sidebar:**
- Create: `src/app/api/anomalies/count/route.ts` — lightweight count endpoint
- Modify: `src/components/Sidebar.tsx` — anomaly badge + border flush fix

---

### Task 1: Base HTML email template + tests

**Files:**
- Modify: `src/lib/mail-templates.ts`
- Create: `src/lib/mail-templates.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/mail-templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderEmailHtml, renderButton } from "./mail-templates";

describe("renderEmailHtml", () => {
  it("wraps content in HTML with ePartner HR header and footer", () => {
    const html = renderEmailHtml("<p>Ciao mondo</p>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("ePartner HR");
    expect(html).toContain("<p>Ciao mondo</p>");
    expect(html).toContain("email automatica");
    expect(html).toContain("hr.epartner.it");
  });

  it("contains logo as base64 data URI", () => {
    const html = renderEmailHtml("<p>test</p>");
    expect(html).toMatch(/src="data:image\/svg\+xml;base64,/);
  });

  it("uses inline styles (no class attributes)", () => {
    const html = renderEmailHtml("<p>test</p>");
    expect(html).toContain('style="');
    // The wrapper elements should not use class= (email-safe)
    expect(html).not.toMatch(/<table[^>]*class="/);
  });
});

describe("renderButton", () => {
  it("produces an anchor styled as a button", () => {
    const btn = renderButton("Vai", "https://hr.epartner.it/leaves");
    expect(btn).toContain('href="https://hr.epartner.it/leaves"');
    expect(btn).toContain("Vai");
    expect(btn).toContain("background-color");
    expect(btn).toContain("#004253");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run src/lib/mail-templates.test.ts`
Expected: FAIL — `renderEmailHtml` and `renderButton` not exported.

- [ ] **Step 3: Implement `renderEmailHtml` and `renderButton`**

In `src/lib/mail-templates.ts`, add at the top (after imports, before existing templates):

```ts
import { readFileSync } from "fs";
import { join } from "path";

// Base64-encode logo for inline email use (emails can't fetch local URLs)
let logoBase64: string;
try {
  const svg = readFileSync(join(process.cwd(), "public/logo.svg"), "utf-8");
  logoBase64 = Buffer.from(svg).toString("base64");
} catch {
  logoBase64 = ""; // fallback: no logo if file not found
}

export function renderButton(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background-color:#004253;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;mso-padding-alt:0;text-align:center">${label}</a>`;
}

export function renderEmailHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f8f9fa;font-family:Arial,Helvetica,sans-serif;color:#191c1d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f9fa">
  <tr><td align="center" style="padding:32px 16px 0">
    <!-- Header -->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background-color:#004253;border-radius:12px 12px 0 0;padding:20px 32px;text-align:left">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          ${logoBase64 ? `<td style="padding-right:12px"><img src="data:image/svg+xml;base64,${logoBase64}" alt="ePartner HR" width="32" height="32" style="display:block"></td>` : ""}
          <td style="color:#ffffff;font-size:20px;font-weight:700;line-height:1.2">ePartner HR</td>
        </tr></table>
      </td></tr>
    </table>
    <!-- Body -->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background-color:#ffffff;padding:32px;font-size:14px;line-height:1.6;color:#191c1d">
        ${body}
      </td></tr>
    </table>
    <!-- Footer -->
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
      <tr><td style="background-color:#f8f9fa;border-top:1px solid #e1e3e4;padding:20px 32px;text-align:center;font-size:12px;color:#6f797c;line-height:1.5">
        ePartner HR — Questa è un'email automatica, non rispondere.<br>
        <a href="https://hr.epartner.it" style="color:#004253;text-decoration:underline">hr.epartner.it</a>
      </td></tr>
    </table>
    <div style="height:32px"></div>
  </td></tr>
</table>
</body>
</html>`;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run src/lib/mail-templates.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail-templates.ts src/lib/mail-templates.test.ts
git commit -m "feat(email): HTML base template with ePartner HR branding"
```

---

### Task 2: Migrate existing templates to HTML + add `newPendingLeaveNotification`

**Files:**
- Modify: `src/lib/mail-templates.ts`
- Modify: `src/lib/mail-templates.test.ts`

- [ ] **Step 1: Change `MailReply` type**

Change the existing interface:

```ts
export interface MailReply {
  subject: string;
  text: string;
  html: string;
}
```

- [ ] **Step 2: Update all 5 existing templates to include `html`**

For each template, keep the existing `text` logic unchanged. Add an `html` field that wraps the same content in `renderEmailHtml()`. Example for `replyRequestAccepted`:

```ts
export function replyRequestAccepted(args: {
  originalSubject: string;
  startDate: string;
  endDate: string;
  employeeName: string;
}): MailReply {
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;
  const text =
    `Ciao ${args.employeeName},\n\n` +
    `la tua richiesta di ferie è stata acquisita.\n\n` +
    `Periodo: ${period}\n` +
    `Stato: in attesa di approvazione\n\n` +
    `Riceverai una nuova email quando l'amministratore l'avrà approvata o rifiutata.` +
    FOOTER;
  const html = renderEmailHtml(
    `<p>Ciao <strong>${args.employeeName}</strong>,</p>` +
    `<p>la tua richiesta di ferie è stata acquisita.</p>` +
    `<p><strong>Periodo:</strong> ${period}<br><strong>Stato:</strong> in attesa di approvazione</p>` +
    `<p>Riceverai una nuova email quando l'amministratore l'avrà approvata o rifiutata.</p>` +
    `<p style="margin-top:24px">${renderButton("Vai alla piattaforma", "https://hr.epartner.it/leaves")}</p>`
  );
  return { subject: `Re: ${args.originalSubject || "ferie"} — richiesta acquisita`, text, html };
}
```

Apply the same pattern to all 5 templates:
- `replyUnknownSender` — paragraph with explanation, no CTA button
- `replyParseError` — paragraph with format example, no CTA button
- `replyRequestAccepted` — as shown above, CTA "Vai alla piattaforma"
- `leaveDecisionNotification` — status with color (`#1a6b2d` for approved, `#ba1a1a` for rejected), CTA "Vai alla piattaforma"
- `leaveCancellationNotification` — warning text, optional reason, CTA "Vai alla piattaforma"

- [ ] **Step 3: Add `newPendingLeaveNotification` template**

```ts
export function newPendingLeaveNotification(args: {
  employeeName: string;
  leaveTypeLabel: string;
  startDate: string;
  endDate: string;
  hours?: number | null;
  notes?: string | null;
}): MailReply {
  const period =
    args.startDate === args.endDate
      ? formatItDate(args.startDate)
      : `dal ${formatItDate(args.startDate)} al ${formatItDate(args.endDate)}`;
  const subject = `Nuova richiesta: ${args.leaveTypeLabel} da ${args.employeeName}`;
  let details = `<strong>Dipendente:</strong> ${args.employeeName}<br>` +
    `<strong>Tipo:</strong> ${args.leaveTypeLabel}<br>` +
    `<strong>Periodo:</strong> ${period}`;
  if (args.hours) details += `<br><strong>Ore:</strong> ${args.hours}`;
  if (args.notes?.trim()) details += `<br><strong>Note:</strong> ${args.notes.trim()}`;

  const text =
    `Nuova richiesta di ${args.leaveTypeLabel} da ${args.employeeName}.\n\n` +
    `Periodo: ${period}` +
    (args.hours ? `\nOre: ${args.hours}` : "") +
    (args.notes?.trim() ? `\nNote: ${args.notes.trim()}` : "") +
    `\n\nAccedi alla piattaforma per approvarla o rifiutarla.` +
    FOOTER;
  const html = renderEmailHtml(
    `<p>Nuova richiesta in attesa di approvazione:</p>` +
    `<p style="background-color:#f3f4f5;border-radius:8px;padding:16px;line-height:1.8">${details}</p>` +
    `<p style="margin-top:24px">${renderButton("Vedi richieste in attesa", "https://hr.epartner.it/leaves")}</p>`
  );
  return { subject, text, html };
}
```

- [ ] **Step 4: Add test for new template**

Append to `src/lib/mail-templates.test.ts`:

```ts
import { newPendingLeaveNotification } from "./mail-templates";

describe("newPendingLeaveNotification", () => {
  it("produces subject with employee name and type", () => {
    const r = newPendingLeaveNotification({
      employeeName: "Stefano Brunelli",
      leaveTypeLabel: "Ferie",
      startDate: "2026-04-21",
      endDate: "2026-04-25",
    });
    expect(r.subject).toBe("Nuova richiesta: Ferie da Stefano Brunelli");
    expect(r.text).toContain("Stefano Brunelli");
    expect(r.html).toContain("Stefano Brunelli");
    expect(r.html).toContain("Ferie");
    expect(r.html).toContain("Vedi richieste in attesa");
  });
});
```

- [ ] **Step 5: Run tests + type-check**

Run: `npx vitest run src/lib/mail-templates.test.ts` — ALL PASS.
Run: `npx tsc --noEmit` — likely errors in callers that use `MailReply` but don't handle `html`. These will be fixed in Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mail-templates.ts src/lib/mail-templates.test.ts
git commit -m "feat(email): HTML versions of all 6 templates + newPendingLeaveNotification"
```

---

### Task 3: Extend `sendMail` + `sendMailGraph` for HTML

**Files:**
- Modify: `src/lib/mail-send.ts`
- Modify: `src/lib/mail-graph.ts`

- [ ] **Step 1: Update `SendMailArgs`**

In `src/lib/mail-send.ts`, add `html` to the interface:

```ts
export interface SendMailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyToMessageId?: string;
}
```

- [ ] **Step 2: Update `sendMailGraph` in `mail-graph.ts`**

Read `src/lib/mail-graph.ts` to find the `sendMailGraph` function. It builds a Graph API payload. Find where `contentType: "Text"` and `content: args.text` are set. Change to:

```ts
contentType: args.html ? "HTML" : "Text",
content: args.html ?? args.text,
```

Also update the function signature to accept the same `SendMailArgs` type (import from `mail-send` or duplicate the shape — whichever the file currently uses). If it receives a plain object, just ensure `html` is passed through.

For the reply path (`/messages/{id}/reply`): the comment body should also use HTML when available. Find where the reply content is set and apply the same logic.

- [ ] **Step 3: Update callers that use `MailReply`**

Search for files that call `sendMail` with template results. The main caller is `src/lib/mail-ingest.ts`. Read it and update every `sendMail({ to, subject: template.subject, text: template.text, ... })` to include `html: template.html`:

```ts
await sendMail({
  to: ...,
  subject: template.subject,
  text: template.text,
  html: template.html,
  replyToMessageId: ...,
});
```

Also check `src/lib/telegram-handlers.ts` or any other file that calls `sendMail` with template results. Update all call sites.

- [ ] **Step 4: Type-check + tests**

Run: `npx tsc --noEmit` — must be clean.
Run: `npx vitest run` — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mail-send.ts src/lib/mail-graph.ts src/lib/mail-ingest.ts
git commit -m "feat(email): sendMail supports HTML contentType via Graph API"
```

---

### Task 4: Schema — `User.receiveLeaveNotifications`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add field to User model**

After the existing `employeeId` field in the `User` model, add:

```prisma
  receiveLeaveNotifications Boolean @default(true)
```

- [ ] **Step 2: Run db:push**

Run: `npm run db:push`
Expected: schema synced.
Run: `npx prisma generate`

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): User.receiveLeaveNotifications flag"
```

---

### Task 5: Leave notification service

**Files:**
- Create: `src/lib/leave-notifications.ts`

- [ ] **Step 1: Implement**

```ts
import { prisma } from "./db";
import { sendMail } from "./mail-send";
import { newPendingLeaveNotification } from "./mail-templates";
import { LEAVE_TYPES, type LeaveType } from "./leaves";
import { notificationsBus } from "./notifications-bus";

export async function notifyAdminsOfPendingLeave(leave: {
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  notes: string | null;
}): Promise<void> {
  const typeLabel = (LEAVE_TYPES as Record<string, { label: string }>)[leave.type]?.label ?? leave.type;

  // 1. Email to opted-in admins
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: "ADMIN",
        active: true,
        receiveLeaveNotifications: true,
      },
      select: { email: true },
    });

    const template = newPendingLeaveNotification({
      employeeName: leave.employeeName,
      leaveTypeLabel: typeLabel,
      startDate: leave.startDate,
      endDate: leave.endDate,
      hours: leave.hours,
      notes: leave.notes,
    });

    for (const admin of admins) {
      if (admin.email) {
        void sendMail({
          to: admin.email,
          subject: template.subject,
          text: template.text,
          html: template.html,
        });
      }
    }
  } catch (err) {
    console.error("[leave-notifications] email failed:", err);
  }

  // 2. In-app notification via bus
  try {
    notificationsBus.publish({
      employeeId: leave.employeeId,
      employeeName: leave.employeeName,
      action: "LEAVE_PENDING",
      time: typeLabel,
      date: leave.startDate,
    });
  } catch (err) {
    console.error("[leave-notifications] bus publish failed:", err);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` — will fail because `LEAVE_PENDING` not in `NotificationAction` yet. That's OK — Task 6 fixes it.

- [ ] **Step 3: Commit**

```bash
git add src/lib/leave-notifications.ts
git commit -m "feat(notifications): notifyAdminsOfPendingLeave service"
```

---

### Task 6: Extend NotificationBus + client types

**Files:**
- Modify: `src/lib/notifications-bus.ts`
- Modify: `src/lib/useNotifications.ts`

- [ ] **Step 1: Server-side — add `LEAVE_PENDING` to action type**

In `src/lib/notifications-bus.ts`, change:

```ts
export type NotificationAction = "ENTRY" | "EXIT" | "PAUSE_START" | "PAUSE_END";
```

to:

```ts
export type NotificationAction = "ENTRY" | "EXIT" | "PAUSE_START" | "PAUSE_END" | "LEAVE_PENDING";
```

- [ ] **Step 2: Client-side — add `LEAVE_PENDING` to type + labels**

In `src/lib/useNotifications.ts`, change the type to match:

```ts
export type NotificationAction = "ENTRY" | "EXIT" | "PAUSE_START" | "PAUSE_END" | "LEAVE_PENDING";
```

Find `ACTION_LABELS` (if it exists — it's referenced in NotificationBell). Add:

```ts
LEAVE_PENDING: "ha richiesto",
```

If `ACTION_LABELS` doesn't exist in this file, search for where it's defined and add there.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` — should be clean now.

- [ ] **Step 4: Commit**

```bash
git add src/lib/notifications-bus.ts src/lib/useNotifications.ts
git commit -m "feat(notifications): LEAVE_PENDING action type on bus + client"
```

---

### Task 7: NotificationBell — render `LEAVE_PENDING`

**Files:**
- Modify: `src/components/NotificationBell.tsx`

- [ ] **Step 1: Add icon mapping**

Add `CalendarPlus` to the lucide import:

```ts
import { Bell, CalendarPlus, LogIn, LogOut, Pause, Play } from "lucide-react";
```

Add case to `actionIcon`:

```ts
case "LEAVE_PENDING":
  return <CalendarPlus className="h-3.5 w-3.5 text-primary" />;
```

- [ ] **Step 2: Customize label display for `LEAVE_PENDING`**

In the event list rendering, the current label format is `{employeeName} {ACTION_LABELS[action]}` and below it shows `{time}`. For `LEAVE_PENDING`, `time` carries the leave type label (e.g. "Ferie") and `date` carries the start date.

Find the event item rendering (around line 100-108). The current text is:

```tsx
<span className="font-semibold">{evt.employeeName}</span>{" "}
<span className="text-on-surface-variant">{ACTION_LABELS[evt.action]}</span>
```

Conditionally show different text for LEAVE_PENDING:

```tsx
<span className="font-semibold">{evt.employeeName}</span>{" "}
<span className="text-on-surface-variant">
  {evt.action === "LEAVE_PENDING"
    ? `ha richiesto ${evt.time}`
    : ACTION_LABELS[evt.action]}
</span>
```

And for the time display below (which normally shows "HH:MM — N min fa"):

```tsx
<div className="text-[11px] text-on-surface-variant">
  {evt.action === "LEAVE_PENDING"
    ? `${evt.date} — ${relativeTime(evt.ts)}`
    : `${evt.time} — ${relativeTime(evt.ts)}`}
</div>
```

- [ ] **Step 3: Update dropdown title**

Change the header from "Timbrature in tempo reale" to "Notifiche in tempo reale" (since it now includes leave events too):

```tsx
<h3 className="text-sm font-semibold text-on-surface">Notifiche in tempo reale</h3>
```

And the empty state from "Nessuna timbratura nelle ultime ore" to "Nessuna notifica nelle ultime ore".

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add src/components/NotificationBell.tsx
git commit -m "feat(ui): NotificationBell shows LEAVE_PENDING events"
```

---

### Task 8: Wire notification into leaves API POST

**Files:**
- Modify: `src/app/api/leaves/route.ts`

- [ ] **Step 1: Add import**

```ts
import { notifyAdminsOfPendingLeave } from "@/lib/leave-notifications";
```

- [ ] **Step 2: Fire notification after PENDING leave creation**

Find the `prisma.leaveRequest.create()` call (around line 121-137). Right after the `const leave = ...` and before the `return NextResponse.json(...)`, add:

```ts
    // Notify admins of pending leave (fire-and-forget)
    if (!isAdmin) {
      void notifyAdminsOfPendingLeave({
        employeeId: leave.employeeId,
        employeeName: leave.employee.displayName || leave.employee.name,
        type: leave.type,
        startDate: leave.startDate,
        endDate: leave.endDate,
        hours: leave.hours,
        notes: leave.notes,
      });
    }
```

The `void` ensures it's fire-and-forget — the response returns immediately.

- [ ] **Step 3: Type-check + tests**

Run: `npx tsc --noEmit` — clean.
Run: `npx vitest run` — all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/leaves/route.ts
git commit -m "feat(api): notify admins on pending leave request (email + in-app)"
```

---

### Task 9: Settings → Utenti — toggle for `receiveLeaveNotifications`

**Files:**
- Modify: `src/app/(dashboard)/settings/users/page.tsx`
- Modify: `src/app/api/settings/users/route.ts` (or wherever the user update API lives)

- [ ] **Step 1: Read the users settings page and API**

Read both files to understand the current structure. The page lists active users with role selects. The API handles activation and role changes.

- [ ] **Step 2: Add `receiveLeaveNotifications` to the `ActiveUser` interface**

In the settings/users page, add:

```ts
interface ActiveUser {
  // ... existing fields ...
  receiveLeaveNotifications: boolean;
}
```

- [ ] **Step 3: Add toggle in the active users table**

For each row where `u.role === "ADMIN"`, add a checkbox/toggle:

```tsx
{u.role === "ADMIN" && (
  <label className="inline-flex items-center gap-1.5 cursor-pointer">
    <input
      type="checkbox"
      checked={u.receiveLeaveNotifications}
      onChange={() => handleToggleNotifications(u.id, !u.receiveLeaveNotifications)}
      className="h-4 w-4 rounded border-outline-variant text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
    />
    <span className="text-xs text-on-surface-variant">Notifiche ferie</span>
  </label>
)}
```

- [ ] **Step 4: Add `handleToggleNotifications` function**

```ts
async function handleToggleNotifications(userId: string, value: boolean) {
  const res = await fetch("/api/settings/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, receiveLeaveNotifications: value }),
  });
  if (res.ok) {
    toast.success(value ? "Notifiche ferie attivate" : "Notifiche ferie disattivate");
    loadAll();
  } else {
    toast.error("Errore nell'aggiornamento");
  }
}
```

- [ ] **Step 5: Update the API to handle the new field**

Read the users API route. Add a handler for `PATCH` (or extend existing PUT/PATCH) that accepts `{ userId, receiveLeaveNotifications }` and does:

```ts
await prisma.user.update({
  where: { id: userId },
  data: { receiveLeaveNotifications: value },
});
```

Also make sure the GET endpoint returns `receiveLeaveNotifications` for each active user.

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` — clean.

```bash
git add "src/app/(dashboard)/settings/users/page.tsx" "src/app/api/settings/users/route.ts"
git commit -m "feat(ui): toggle receiveLeaveNotifications on Settings → Utenti"
```

---

### Task 10: Anomaly count API endpoint

**Files:**
- Create: `src/app/api/anomalies/count/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const today = new Date().toISOString().split("T")[0];
  const count = await prisma.anomaly.count({
    where: { resolved: false, date: { lt: today } },
  });

  return NextResponse.json({ count });
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add src/app/api/anomalies/count/route.ts
git commit -m "feat(api): lightweight anomaly count endpoint (unresolved, date < today)"
```

---

### Task 11: Sidebar — anomaly badge + border flush fix

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add anomaly count state + fetch**

Add state alongside `pendingLeaves`:

```ts
const [anomalyCount, setAnomalyCount] = useState(0);
```

In the existing `useEffect` that fetches pending leaves, add a parallel fetch (only for admin):

```ts
useEffect(() => {
  fetch("/api/leaves?status=PENDING")
    .then((r) => r.ok ? r.json() : [])
    .then((data: unknown[]) => setPendingLeaves(data.length))
    .catch(() => {});
  if (isAdmin) {
    fetch("/api/anomalies/count")
      .then((r) => r.ok ? r.json() : { count: 0 })
      .then((data: { count: number }) => setAnomalyCount(data.count))
      .catch(() => {});
  }
}, [pathname, isAdmin]);
```

- [ ] **Step 2: Render anomaly badge on "Anomalie" item**

Inside the `navItems.map`, after the existing leaves badge block, add a similar badge for anomalies:

```tsx
{item.href === "/anomalies" && anomalyCount > 0 && (
  <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warning-container px-1 text-[10px] font-bold text-warning">
    {anomalyCount}
    <span className="sr-only"> anomalie da verificare</span>
  </span>
)}
```

- [ ] **Step 3: Fix active border — flush right**

The nav container currently has `px-3` (line 77: `<nav className="flex-1 px-3">`). Change to:

```tsx
<nav className="flex-1 pl-3 pr-0">
```

On each nav link, the active state class has `border-r-4 border-primary-container bg-surface-container-low`. This is correct — with `pr-0` on the container, the border now touches the sidebar edge.

For inactive items, add right margin to maintain visual inset:

```tsx
className={`flex items-center gap-3 px-4 py-3 transition-colors duration-200 ${
  isActive
    ? "border-r-4 border-primary-container bg-surface-container-low font-bold text-primary"
    : "mr-3 text-on-surface-variant hover:text-primary-container"
}`}
```

Apply the same fix to the Settings link at the bottom (same active/inactive pattern).

Also fix the bottom section container: `<div className="border-t border-outline-variant/30 px-3 pt-6">` → change to `pl-3 pr-0`:

```tsx
<div className="border-t border-outline-variant/30 pl-3 pr-0 pt-6">
```

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit` — clean.

```bash
git add src/components/Sidebar.tsx src/app/api/anomalies/count/route.ts
git commit -m "feat(sidebar): anomaly count badge + active border flush right"
```

---

### Task 12: Full verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run` — all tests pass (115 existing + new template tests).
Run: `npx tsc --noEmit` — clean.

- [ ] **Step 2: Manual verification — email template**

Start dev server. Trigger an email (e.g., create a leave request via email ingest or test the template output by temporarily logging `template.html` in the leaves route). Paste the HTML into an email preview tool (e.g., Litmus or just open in browser) and verify:
- ePartner HR header with logo
- White card body with content
- CTA button styled correctly
- Footer with link

- [ ] **Step 3: Manual verification — notification pipeline**

Log in as a dipendente (non-admin) account. Create a leave request. Verify:
- Admin's NotificationBell shows a `LEAVE_PENDING` event with CalendarPlus icon
- If Graph is configured, admin receives HTML email with "Nuova richiesta" subject

- [ ] **Step 4: Manual verification — sidebar**

Log in as admin. Verify:
- "Anomalie" badge shows count of unresolved anomalies from previous days
- Active sidebar item border touches the right edge (zero gap)
- Inactive items have visual inset from the right

---

## Done

12 tasks across 3 sub-projects: A (email template system, tasks 1-3), B (notification pipeline, tasks 4-9), C (sidebar, tasks 10-11), plus verification (task 12).
