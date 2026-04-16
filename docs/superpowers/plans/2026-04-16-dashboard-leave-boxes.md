# Dashboard Leave Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two side-by-side dashboard boxes showing who is on approved leave today and in the next 14 days, with named employees and Italian date formatting.

**Architecture:** Extend the existing `GET /api/stats/dashboard` response with two new arrays (`todayLeaves`, `upcomingLeaves`) built from the same Prisma query already in the endpoint. Two new presentational components consume the data. A shared formatter produces Italian date strings.

**Tech Stack:** Next.js 16 App Router, Prisma 6 + SQLite, React 19, Tailwind 4, lucide-react icons, existing `StatusBadge` component, existing `getInitials` from `@/lib/avatar-utils`.

**Spec:** [docs/superpowers/specs/2026-04-16-dashboard-leave-boxes-design.md](../specs/2026-04-16-dashboard-leave-boxes-design.md)

---

## File map

**Library code:**
- Create: `src/lib/leave-format.ts` — Italian date/time formatter for leave detail strings
- Create: `src/lib/leave-format.test.ts` — unit tests for the formatter

**Types:**
- Modify: `src/types/dashboard.ts` — add `LeaveListItem` interface + extend `DashboardStatsResponse`

**API:**
- Modify: `src/app/api/stats/dashboard/route.ts` — add one Prisma query for upcoming leaves, build `todayLeaves` and `upcomingLeaves` arrays from existing + new data

**Components:**
- Create: `src/components/dashboard/TodayLeavesBox.tsx`
- Create: `src/components/dashboard/UpcomingLeavesBox.tsx`

**Page:**
- Modify: `src/app/(dashboard)/page.tsx` — import + render the two new boxes between TodayOverview and KpiGrid

---

### Task 1: Date formatter — failing tests

**Files:**
- Create: `src/lib/leave-format.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { formatLeaveDetail } from "./leave-format";

describe("formatLeaveDetail — context today", () => {
  const today = "2026-04-16";

  it("single-day vacation on today → 'solo oggi'", () => {
    expect(
      formatLeaveDetail(
        { type: "VACATION", startDate: "2026-04-16", endDate: "2026-04-16", hours: null, timeSlots: null },
        "today",
        today
      )
    ).toBe("solo oggi");
  });

  it("multi-day vacation ending in the future → 'fino al DD Mese'", () => {
    expect(
      formatLeaveDetail(
        { type: "VACATION", startDate: "2026-04-14", endDate: "2026-04-25", hours: null, timeSlots: null },
        "today",
        today
      )
    ).toBe("fino al 25 Aprile");
  });

  it("half-day AM → 'mattina'", () => {
    expect(
      formatLeaveDetail(
        { type: "VACATION_HALF_AM", startDate: "2026-04-16", endDate: "2026-04-16", hours: null, timeSlots: null },
        "today",
        today
      )
    ).toBe("mattina");
  });

  it("half-day PM → 'pomeriggio'", () => {
    expect(
      formatLeaveDetail(
        { type: "VACATION_HALF_PM", startDate: "2026-04-16", endDate: "2026-04-16", hours: null, timeSlots: null },
        "today",
        today
      )
    ).toBe("pomeriggio");
  });

  it("ROL with timeSlots → 'dalle HH:MM alle HH:MM'", () => {
    expect(
      formatLeaveDetail(
        { type: "ROL", startDate: "2026-04-16", endDate: "2026-04-16", hours: 3, timeSlots: '[{"from":"09:00","to":"12:00"}]' },
        "today",
        today
      )
    ).toBe("dalle 9:00 alle 12:00");
  });

  it("strips leading zero from hours in timeSlots", () => {
    expect(
      formatLeaveDetail(
        { type: "ROL", startDate: "2026-04-16", endDate: "2026-04-16", hours: 1.5, timeSlots: '[{"from":"08:30","to":"10:00"}]' },
        "today",
        today
      )
    ).toBe("dalle 8:30 alle 10:00");
  });

  it("sick multi-day → 'fino al DD Mese'", () => {
    expect(
      formatLeaveDetail(
        { type: "SICK", startDate: "2026-04-10", endDate: "2026-04-20", hours: null, timeSlots: null },
        "today",
        today
      )
    ).toBe("fino al 20 Aprile");
  });
});

describe("formatLeaveDetail — context upcoming", () => {
  const today = "2026-04-16";

  it("single future day → 'il DD Mese'", () => {
    expect(
      formatLeaveDetail(
        { type: "VACATION", startDate: "2026-04-22", endDate: "2026-04-22", hours: null, timeSlots: null },
        "upcoming",
        today
      )
    ).toBe("il 22 Aprile");
  });

  it("multi-day range → 'dal DD Mese al DD Mese'", () => {
    expect(
      formatLeaveDetail(
        { type: "VACATION", startDate: "2026-04-21", endDate: "2026-04-25", hours: null, timeSlots: null },
        "upcoming",
        today
      )
    ).toBe("dal 21 Aprile al 25 Aprile");
  });

  it("cross-month range → 'dal DD Mese al DD Mese'", () => {
    expect(
      formatLeaveDetail(
        { type: "SICK", startDate: "2026-03-23", endDate: "2026-04-03", hours: null, timeSlots: null },
        "upcoming",
        today
      )
    ).toBe("dal 23 Marzo al 3 Aprile");
  });

  it("half-day AM future → 'il DD Mese, mattina'", () => {
    expect(
      formatLeaveDetail(
        { type: "VACATION_HALF_AM", startDate: "2026-04-22", endDate: "2026-04-22", hours: null, timeSlots: null },
        "upcoming",
        today
      )
    ).toBe("il 22 Aprile, mattina");
  });

  it("ROL with timeSlots future → 'il DD Mese, dalle HH:MM alle HH:MM'", () => {
    expect(
      formatLeaveDetail(
        { type: "ROL", startDate: "2026-04-22", endDate: "2026-04-22", hours: 2, timeSlots: '[{"from":"09:00","to":"11:00"}]' },
        "upcoming",
        today
      )
    ).toBe("il 22 Aprile, dalle 9:00 alle 11:00");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/leave-format.test.ts`
Expected: FAIL — module `./leave-format` does not exist.

---

### Task 2: Date formatter — implementation

**Files:**
- Create: `src/lib/leave-format.ts`

- [ ] **Step 1: Implement the formatter**

```ts
const MESI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

interface LeaveFormatInput {
  type: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  hours: number | null;
  timeSlots: string | null; // JSON
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${MESI[parseInt(m, 10) - 1]}`;
}

function stripLeadingZero(time: string): string {
  return time.replace(/^0(\d)/, "$1");
}

function formatTimeRange(timeSlots: string): string | null {
  try {
    const slots = JSON.parse(timeSlots) as { from: string; to: string }[];
    if (!slots.length) return null;
    const s = slots[0];
    return `dalle ${stripLeadingZero(s.from)} alle ${stripLeadingZero(s.to)}`;
  } catch {
    return null;
  }
}

export function formatLeaveDetail(
  leave: LeaveFormatInput,
  context: "today" | "upcoming",
  today: string
): string {
  const { type, startDate, endDate, timeSlots } = leave;

  if (context === "today") {
    if (type === "VACATION_HALF_AM") return "mattina";
    if (type === "VACATION_HALF_PM") return "pomeriggio";
    if (timeSlots) {
      const range = formatTimeRange(timeSlots);
      if (range) return range;
    }
    if (startDate === endDate && startDate === today) return "solo oggi";
    if (endDate > today) return `fino al ${formatDate(endDate)}`;
    return "oggi";
  }

  // context === "upcoming"
  const datePrefix =
    startDate === endDate
      ? `il ${formatDate(startDate)}`
      : `dal ${formatDate(startDate)} al ${formatDate(endDate)}`;

  if (type === "VACATION_HALF_AM") return `${datePrefix}, mattina`;
  if (type === "VACATION_HALF_PM") return `${datePrefix}, pomeriggio`;
  if (timeSlots) {
    const range = formatTimeRange(timeSlots);
    if (range) return `il ${formatDate(startDate)}, ${range}`;
  }
  return datePrefix;
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/lib/leave-format.test.ts`
Expected: ALL PASS (12 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/leave-format.ts src/lib/leave-format.test.ts
git commit -m "feat(dashboard): leave detail date formatter with Italian months"
```

---

### Task 3: Types — add `LeaveListItem` and extend response

**Files:**
- Modify: `src/types/dashboard.ts`

- [ ] **Step 1: Add the interface and extend response**

At the bottom of `src/types/dashboard.ts`, add:

```ts
// ── Leave detail for dashboard boxes ─────────────────────────────────

export interface LeaveListItem {
  employeeId: string;
  employeeName: string;
  type: string; // VACATION | VACATION_HALF_AM | VACATION_HALF_PM | ROL | SICK | BEREAVEMENT | MARRIAGE | LAW_104 | MEDICAL_VISIT
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
}
```

In the `DashboardStatsResponse` interface, add two new fields after `leaveBalances`:

```ts
  // Sezione A+ — Dettaglio assenze oggi e prossime
  todayLeaves: LeaveListItem[];
  upcomingLeaves: LeaveListItem[];
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in `route.ts` and `page.tsx` because the response now requires `todayLeaves`/`upcomingLeaves` but they're not populated yet. This is expected — we fix it in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/types/dashboard.ts
git commit -m "feat(types): LeaveListItem + todayLeaves/upcomingLeaves on dashboard response"
```

---

### Task 4: API — populate `todayLeaves` and `upcomingLeaves`

**Files:**
- Modify: `src/app/api/stats/dashboard/route.ts`

- [ ] **Step 1: Add the upcoming leaves query to the Promise.all**

The file already queries `todayLeaves` at line ~105:
```ts
prisma.leaveRequest.findMany({
  where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } },
}),
```

Add a NEW query for upcoming leaves (next 14 days, starting AFTER today). Insert it right after the `todayLeaves` query in the `Promise.all` array. Compute `today14` before the Promise.all:

```ts
const today14 = new Date(now.getTime() + 14 * 86400000).toISOString().split("T")[0];
```

New query (add to Promise.all, right after the existing todayLeaves query):
```ts
// Leaves dei prossimi 14 giorni (startDate > today, startDate <= today+14)
prisma.leaveRequest.findMany({
  where: { status: "APPROVED", startDate: { gt: today, lte: today14 } },
  include: { employee: { select: { id: true, name: true, displayName: true } } },
  orderBy: [{ startDate: "asc" }],
}),
```

Also modify the EXISTING `todayLeaves` query to include employee data (currently it doesn't):
```ts
prisma.leaveRequest.findMany({
  where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } },
  include: { employee: { select: { id: true, name: true, displayName: true } } },
}),
```

Update the destructuring to include the new variable:
```ts
const [
  allEmployees,
  schedules,
  todayRecords,
  currentRecords,
  prevRecords,
  todayLeaves,
  upcomingLeavesRaw,   // ← NEW
  periodLeaves,
  // ... rest unchanged
```

(Careful: inserting a new item in the array shifts all subsequent variable names. Count positions carefully.)

- [ ] **Step 2: Build the LeaveListItem arrays**

After the existing `todayLeaveMap` logic (~line 189-201), add the mapping:

```ts
import type { LeaveListItem } from "@/types/dashboard";
```
(Add at top of file with other imports.)

```ts
// ── Leave detail lists for dashboard boxes ──────────────────────────
const todayLeavesList: LeaveListItem[] = todayLeaves
  .sort((a, b) => a.employee.name.localeCompare(b.employee.name))
  .map((l) => ({
    employeeId: l.employeeId,
    employeeName: l.employee.displayName ?? l.employee.name,
    type: l.type,
    startDate: l.startDate,
    endDate: l.endDate,
    hours: l.hours,
    timeSlots: l.timeSlots,
  }));

const upcomingLeavesList: LeaveListItem[] = upcomingLeavesRaw
  .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employee.name.localeCompare(b.employee.name))
  .map((l) => ({
    employeeId: l.employeeId,
    employeeName: l.employee.displayName ?? l.employee.name,
    type: l.type,
    startDate: l.startDate,
    endDate: l.endDate,
    hours: l.hours,
    timeSlots: l.timeSlots,
  }));
```

- [ ] **Step 3: Include in the response object**

Find the `return NextResponse.json(...)` at the bottom of the handler. Add:

```ts
    todayLeaves: todayLeavesList,
    upcomingLeaves: upcomingLeavesList,
```

After `leaveBalances`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (or only pre-existing issues unrelated to this change).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stats/dashboard/route.ts src/types/dashboard.ts
git commit -m "feat(api): add todayLeaves + upcomingLeaves to dashboard response"
```

---

### Task 5: Component — `TodayLeavesBox`

**Files:**
- Create: `src/components/dashboard/TodayLeavesBox.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { CalendarCheck } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { getInitials } from "@/lib/avatar-utils";
import { formatLeaveDetail } from "@/lib/leave-format";
import { LEAVE_TYPES } from "@/lib/leaves";
import type { LeaveListItem } from "@/types/dashboard";

function leaveKind(type: string): "info" | "warning" | "neutral" {
  if (["VACATION", "VACATION_HALF_AM", "VACATION_HALF_PM"].includes(type)) return "info";
  if (type === "SICK") return "warning";
  return "neutral";
}

export function TodayLeavesBox({
  leaves,
  today,
}: {
  leaves: LeaveListItem[];
  today: string;
}) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-primary" strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-on-surface">
            Ferie & permessi oggi
          </h3>
        </div>
        <StatusBadge kind="info">{leaves.length}</StatusBadge>
      </div>

      {leaves.length === 0 ? (
        <p className="py-4 text-center text-sm text-on-surface-variant">
          Nessuna assenza oggi
        </p>
      ) : (
        <ul className="max-h-80 space-y-3 overflow-y-auto" role="list">
          {leaves.map((l) => (
            <li key={`${l.employeeId}-${l.type}-${l.startDate}`} className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container text-xs font-bold">
                {getInitials(l.employeeName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-on-surface">
                    {l.employeeName}
                  </span>
                  <StatusBadge kind={leaveKind(l.type)}>
                    {(LEAVE_TYPES as Record<string, { label: string }>)[l.type]?.label ?? l.type}
                  </StatusBadge>
                </div>
                <p className="text-xs text-on-surface-variant">
                  {formatLeaveDetail(l, "today", today)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/TodayLeavesBox.tsx
git commit -m "feat(ui): TodayLeavesBox dashboard component"
```

---

### Task 6: Component — `UpcomingLeavesBox`

**Files:**
- Create: `src/components/dashboard/UpcomingLeavesBox.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { CalendarClock } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { getInitials } from "@/lib/avatar-utils";
import { formatLeaveDetail } from "@/lib/leave-format";
import { LEAVE_TYPES } from "@/lib/leaves";
import type { LeaveListItem } from "@/types/dashboard";

function leaveKind(type: string): "info" | "warning" | "neutral" {
  if (["VACATION", "VACATION_HALF_AM", "VACATION_HALF_PM"].includes(type)) return "info";
  if (type === "SICK") return "warning";
  return "neutral";
}

export function UpcomingLeavesBox({
  leaves,
  today,
}: {
  leaves: LeaveListItem[];
  today: string;
}) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-on-surface">
            Prossimi 14 giorni
          </h3>
        </div>
        <StatusBadge kind="info">{leaves.length}</StatusBadge>
      </div>

      {leaves.length === 0 ? (
        <p className="py-4 text-center text-sm text-on-surface-variant">
          Nessuna assenza pianificata
        </p>
      ) : (
        <ul className="max-h-80 space-y-3 overflow-y-auto" role="list">
          {leaves.map((l) => (
            <li key={`${l.employeeId}-${l.type}-${l.startDate}`} className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container text-xs font-bold">
                {getInitials(l.employeeName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-on-surface">
                    {l.employeeName}
                  </span>
                  <StatusBadge kind={leaveKind(l.type)}>
                    {(LEAVE_TYPES as Record<string, { label: string }>)[l.type]?.label ?? l.type}
                  </StatusBadge>
                </div>
                <p className="text-xs text-on-surface-variant">
                  {formatLeaveDetail(l, "upcoming", today)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit`

```bash
git add src/components/dashboard/UpcomingLeavesBox.tsx
git commit -m "feat(ui): UpcomingLeavesBox dashboard component"
```

---

### Task 7: Dashboard page — wire in the two boxes

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`

- [ ] **Step 1: Add imports**

At the top of the file, add alongside other dashboard component imports:

```tsx
import { TodayLeavesBox } from "@/components/dashboard/TodayLeavesBox";
import { UpcomingLeavesBox } from "@/components/dashboard/UpcomingLeavesBox";
```

- [ ] **Step 2: Insert the boxes between TodayOverview and KpiGrid**

Find the section that reads:

```tsx
          {/* SEZIONE A — Riepilogo Oggi (solo admin) */}
          {isAdmin && <TodayOverview data={data.today} />}

          {/* SEZIONE B — KPI */}
          <KpiGrid kpi={data.kpi} />
```

Insert between them:

```tsx
          {/* SEZIONE A+ — Dettaglio ferie & permessi oggi + prossimi 14 giorni (solo admin) */}
          {isAdmin && (data.todayLeaves.length > 0 || data.upcomingLeaves.length > 0) && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TodayLeavesBox leaves={data.todayLeaves} today={new Date().toISOString().split("T")[0]} />
              <UpcomingLeavesBox leaves={data.upcomingLeaves} today={new Date().toISOString().split("T")[0]} />
            </div>
          )}
```

Note: the condition shows the section only if at least one box has content. Both boxes still render their own empty state internally, so if only one side has data the other shows "Nessuna assenza...". If BOTH are empty the entire row is hidden (dashboard stays clean).

- [ ] **Step 3: Type-check + full test suite**

Run: `npx tsc --noEmit` and `npx vitest run`
Expected: clean + all tests pass (103 existing + 12 new formatter tests = 115).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/page.tsx"
git commit -m "feat(dashboard): wire TodayLeavesBox + UpcomingLeavesBox below TodayOverview"
```

---

### Task 8: Manual verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`. Open `http://localhost:3000`.

- [ ] **Step 2: Verify with existing leave data**

Login as admin. On the dashboard, below the 3 TodayOverview cards, you should see:
- **"Ferie & permessi oggi"** on the left — lists any employees with approved leaves overlapping today.
- **"Prossimi 14 giorni"** on the right — lists upcoming approved leaves starting in the next 2 weeks.
- If no leave data exists, create a test `LeaveRequest` (via the "Ferie & Permessi" page) for today and for a future date, then refresh the dashboard.

- [ ] **Step 3: Verify date formatting**

- A multi-day vacation should show "fino al DD Mese" (today box) or "dal DD Mese al DD Mese" (upcoming box).
- A half-day should show "mattina" or "pomeriggio".
- A ROL permit with timeSlots should show "dalle H:MM alle H:MM".
- Hours should not have leading zeros (9:00 not 09:00).

- [ ] **Step 4: Verify empty state**

If both boxes are empty, the entire row should be hidden. If one has data and the other doesn't, the empty one shows "Nessuna assenza oggi" / "Nessuna assenza pianificata".

---

## Done

7 implementation tasks + 1 verification. Feature is self-contained: formatter + types + API extension + 2 components + page wiring.
