# Email Template System + Leave Notification Pipeline + Sidebar Enhancements — Design Spec

**Date:** 2026-04-16
**Author:** Stefano Brunelli (brainstormed with Claude)
**Status:** Draft — awaiting review

---

## 1. Overview

Three sub-projects executed in order A → B → C:

| Sub-project | Scope |
|---|---|
| **A** | HTML email base template with ePartner HR branding; migrate all 5 existing plain-text templates to HTML; extend `sendMail` to support HTML |
| **B** | Notify admin users (email + in-app) when a dipendente submits a pending leave request; new `receiveLeaveNotifications` flag on `User`; extend `NotificationBus` with `LEAVE_PENDING` action; toggle in Settings → Utenti |
| **C** | Sidebar: badge count for unresolved anomalies (date < today) on "Anomalie"; fix active-item border-right to flush with sidebar edge |

**Existing admin→dipendente notifications (approve/reject/cancel) are NOT touched.**

---

## 2. Sub-project A — HTML Email Template System

### 2.1 Base template function

**File:** `src/lib/mail-templates.ts`

New export `renderEmailHtml(body: string): string` that wraps arbitrary HTML content in a responsive email layout:

```
┌────────────────────────────────────────┐
│  Header: bg #004253 (primary)          │
│  Logo (base64 inline) + "ePartner HR"  │
├────────────────────────────────────────┤
│  Body card: bg #ffffff, max-w 600px    │
│  border-radius 12px, padding 32px     │
│                                        │
│  {body content here}                   │
│                                        │
├────────────────────────────────────────┤
│  Footer: "ePartner HR"                 │
│  "Questa è un'email automatica"        │
│  Link: https://hr.epartner.it          │
│  text #6f797c, font-size 12px          │
└────────────────────────────────────────┘
```

- Background: `#f8f9fa` (surface)
- Card: `#ffffff`, centered, `max-width: 600px`, `border-radius: 12px`
- All CSS **inline** (email-safe — no `<style>` block, no Tailwind classes)
- Logo: read `/public/logo.svg` at build-time, convert to base64 data-URI `src="data:image/svg+xml;base64,..."` (emails don't fetch external URLs)
- Header text: "ePartner HR" in `#ffffff`, `font-size: 20px`, `font-weight: 700`
- CTA button helper: `renderButton(label: string, href: string): string` — returns an inline-styled `<a>` that looks like a button (`bg: #004253`, `color: #fff`, `border-radius: 8px`, `padding: 12px 24px`)

### 2.2 Template return type change

Current: `{ subject: string; text: string }`
New: `{ subject: string; text: string; html: string }`

- `text` = plain-text fallback (keeps existing logic, just strips tags or uses current text)
- `html` = the body content wrapped in `renderEmailHtml()`

### 2.3 Migrate existing templates

All 5 templates produce `html` in addition to `text`:

| Template | HTML body |
|---|---|
| `replyUnknownSender` | Paragraph explaining unknown sender + bold email address |
| `replyParseError` | Paragraph with error hint |
| `replyRequestAccepted` | Employee name, dates, type. CTA button "Vedi richieste" → `https://hr.epartner.it/leaves` |
| `leaveDecisionNotification` | Employee name, dates, status (APPROVATA / RIFIUTATA) with color-coded badge, optional notes. CTA button "Vai alla piattaforma" |
| `leaveCancellationNotification` | Employee name, dates, previous status, optional reason |

### 2.4 `sendMail` extension

**File:** `src/lib/mail-send.ts`

`SendMailArgs` gains `html?: string`. When present, the Graph API `sendMail` call uses `contentType: "HTML"` and `content: args.html`. Plain `text` remains as the text/plain alternative (Graph supports multipart).

For the `replyToMessageId` path (reply to ingest): the reply body also switches to HTML when `html` is provided.

### 2.5 New template: `newPendingLeaveNotification`

```ts
export function newPendingLeaveNotification(params: {
  employeeName: string;
  leaveTypeLabel: string; // "Ferie", "Permesso ROL", etc.
  startDate: string;
  endDate: string;
  hours?: number | null;
  notes?: string | null;
}): { subject: string; text: string; html: string }
```

- Subject: `"Nuova richiesta: {leaveTypeLabel} da {employeeName}"`
- HTML body: "**{employeeName}** ha inviato una richiesta di **{leaveTypeLabel}**" + date range + optional hours + optional notes + CTA button "Vedi richieste in attesa" → `https://hr.epartner.it/leaves`
- Text fallback: same content as plain text

---

## 3. Sub-project B — Leave Notification Pipeline

### 3.1 Schema change

**File:** `prisma/schema.prisma`

```prisma
model User {
  // ... existing fields ...
  receiveLeaveNotifications Boolean @default(true)
}
```

Applied via `npm run db:push`.

### 3.2 Trigger point

**File:** `src/app/api/leaves/route.ts` (POST handler)

After a `LeaveRequest` is created with `status = "PENDING"`, fire-and-forget:

```ts
void notifyAdminsOfPendingLeave(createdLeave, employee);
```

The `notifyAdminsOfPendingLeave` function (new, in `src/lib/leave-notifications.ts`):

1. Query admin users: `prisma.user.findMany({ where: { role: "ADMIN", active: true, receiveLeaveNotifications: true } })`
2. For each admin with a non-null `email`:
   - Build email with `newPendingLeaveNotification(...)` template
   - Call `sendMail({ to: admin.email, ...template })`
3. Publish in-app notification: `notificationsBus.publish({ employeeId, employeeName, action: "LEAVE_PENDING", time: leaveTypeLabel, date: startDate })`

All wrapped in try/catch — failures logged but never block the leave creation response.

### 3.3 NotificationBus extension

**File:** `src/lib/notifications-bus.ts`

- `NotificationAction` type: add `"LEAVE_PENDING"` to the union
- No other structural changes — the bus is generic, it just needs the type expanded

### 3.4 NotificationBell update

**File:** `src/components/NotificationBell.tsx`

- `actionIcon` mapping: add `LEAVE_PENDING` → `<CalendarPlus>` icon in `text-primary`
- `actionLabel` (or inline text): format as "**{employeeName}** ha richiesto {leaveTypeLabel}" — the `time` field carries the type label, `date` carries the start date
- Existing notification items unchanged

### 3.5 Settings → Utenti toggle

**File:** `src/app/(dashboard)/settings/users/page.tsx`

For rows where `role === "ADMIN"`: add a toggle/checkbox column "Notifiche ferie".

- Renders a checkbox (or small toggle) bound to `user.receiveLeaveNotifications`
- On change: `PATCH /api/settings/users` (or inline fetch to update the flag)
- For non-admin rows: column is empty or hidden

**API:** The users settings endpoint needs to accept `receiveLeaveNotifications` as an updatable field. Check existing PATCH/PUT handler and add the field.

---

## 4. Sub-project C — Sidebar Enhancements

### 4.1 Badge anomalie non risolte

**New endpoint:** `GET /api/anomalies/count`

Returns `{ count: number }` — count of `Anomaly` where `resolved = false` AND `date < today`.

Lightweight query, gated by `checkAuth()` (admin only).

**File:** `src/components/Sidebar.tsx`

- Add a `useEffect` fetch to `/api/anomalies/count` (parallel with existing pending-leaves fetch, same trigger: pathname change)
- On the "Anomalie" nav item: if `anomalyCount > 0`, render a badge identical to the existing pending-leaves badge (same classes: `bg-warning-container text-warning rounded-full ml-auto`), showing the count
- Fetch only if user is admin (Anomalie is `adminOnly: true`)

### 4.2 Fix bordo attivo a filo

**File:** `src/components/Sidebar.tsx`

Current issue: the nav items container has horizontal padding (`px-3` or similar) which pushes the active-state `border-r-4` away from the sidebar's right edge.

Fix approach:
- Remove right padding from the nav items container (keep left padding for indentation)
- Apply `pl-3 pr-0` (or equivalent) to the container
- On inactive items: add `mr-3` to maintain visual spacing from the right edge
- On active item: no right margin — `border-r-4 border-primary-container` goes flush to the sidebar edge
- The active item's background `bg-surface-container-low` also extends to the right edge

This creates a clear visual "tab" effect where the active item bleeds to the right edge while inactive items have inset spacing.

---

## 5. Execution order

1. **A** (template system) — no schema changes, no UI, just lib code
2. **B** (notification pipeline) — schema change (`db:push`) + API + UI (NotificationBell, Settings)
3. **C** (sidebar) — new endpoint + CSS fix

Each sub-project is independently committable and deployable.

---

## 6. Non-goals

- No changes to admin→dipendente notifications (approve/reject/cancel) — already working
- No email digest / batching (each pending request = 1 email)
- No per-admin granular notification preferences beyond the single toggle
- No SMS / push notifications
- No rich-text email editor (templates are code-defined)
- No dark-mode email variant
- No email preview UI in settings
