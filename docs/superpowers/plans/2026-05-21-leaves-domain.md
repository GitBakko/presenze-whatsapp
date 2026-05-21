# Leaves Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve 5 leave-domain audit findings (holiday-aware day count, admin edit with audit trail, overlap detection, email type detection, past-date parser) as one coherent phase.

**Architecture:** Split monolithic `src/lib/leaves.ts` into a `src/lib/leaves/` module organized by concern. Pure logic separated from Prisma/notification side-effects. Add `LeaveRequestEdit` audit table + optimistic-lock `version` column on `LeaveRequest`. PUT endpoint becomes polymorphic (status-only = approve/reject as today; other fields = edit branch). New UI: preview-days block in CreateLeaveModal + EditLeaveModal with audit history accordion.

**Tech Stack:** Next.js 16 (App Router), Prisma (SQLite), NextAuth (JWT), Zod (new dep — verify already in package.json or add), Vitest, sonner toasts (top-center), `useModalA11y` + `ConfirmProvider` (existing).

**Spec:** `docs/superpowers/specs/2026-05-21-leaves-domain-design.md`

**Commands cheat-sheet:**
- Test single file: `npm test -- src/lib/leaves/__tests__/working-days.test.ts`
- Test all: `npm test`
- Schema apply: `npm run db:push`
- Dev server: `npm run dev`

**Convention reminders:**
- Files <500 lines (CLAUDE.md rule).
- No client component if not needed.
- Sonner toasts top-center, ConfirmProvider z-[100].
- Plain `<select>`, no form library.
- Working dir: `D:\Develop\AI\Hr`.

---

## Task 1: Schema delta + version column

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1.1: Add `version` field to `LeaveRequest`**

Edit `prisma/schema.prisma`, find `model LeaveRequest`, append after `approvedAt`:

```prisma
  version      Int       @default(0)  // optimistic-lock counter, incremented on every update

  employee   Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  approvedBy User?    @relation("ApprovedLeaves", fields: [approvedById], references: [id])
  edits      LeaveRequestEdit[]
```

(Add `edits LeaveRequestEdit[]` to the existing relations block; keep the existing two relations untouched in form.)

- [ ] **Step 1.2: Add `leaveEdits` back-relation to `User`**

In `model User`, after the existing `approvedLeaves` line, add:

```prisma
  leaveEdits     LeaveRequestEdit[] @relation("UserLeaveEdits")
```

- [ ] **Step 1.3: Append `LeaveRequestEdit` model**

At the bottom of `prisma/schema.prisma` (before `model AppSetting` or after — anywhere as long as it's at top-level), add:

```prisma
model LeaveRequestEdit {
  id          String   @id @default(cuid())
  leaveId     String
  editedById  String
  editedAt    DateTime @default(now())

  // Snapshot pre-edit (only fields we allow to edit)
  oldType         String?
  oldStartDate    String?
  oldEndDate      String?
  oldHours        Float?
  oldTimeSlots    String?
  oldSickProtocol String?
  oldNotes        String?
  oldStatus       String?

  // Snapshot post-edit
  newType         String?
  newStartDate    String?
  newEndDate      String?
  newHours        Float?
  newTimeSlots    String?
  newSickProtocol String?
  newNotes        String?
  newStatus       String?

  reason        String?
  changedFields String   // JSON array, denormalized for query speed

  leave    LeaveRequest @relation(fields: [leaveId], references: [id], onDelete: Cascade)
  editedBy User         @relation("UserLeaveEdits", fields: [editedById], references: [id])

  @@index([leaveId, editedAt])
  @@index([editedById])
}
```

- [ ] **Step 1.4: Apply schema**

```bash
npm run db:push
```

Expected output: `Your database is now in sync with your schema. Done in ... ms`. No data loss warnings (all new columns have defaults or are nullable).

- [ ] **Step 1.5: Verify Prisma client regenerated**

```bash
npx prisma generate
```

Then verify `node_modules/.prisma/client/index.d.ts` contains `LeaveRequestEdit`:

```bash
grep -l "LeaveRequestEdit" node_modules/.prisma/client/index.d.ts
```

Expected: file path printed (match found).

- [ ] **Step 1.6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(leaves): add edit audit trail schema + version column

Adds LeaveRequestEdit table with old/new snapshots and changedFields
JSON. Adds version column on LeaveRequest for optimistic locking on
concurrent admin edits.

Spec: docs/superpowers/specs/2026-05-21-leaves-domain-design.md (sec 4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Working-days + holidays pure modules

**Files:**
- Create: `src/lib/leaves/holidays.ts`
- Create: `src/lib/leaves/working-days.ts`
- Test: `src/lib/leaves/__tests__/holidays.test.ts`
- Test: `src/lib/leaves/__tests__/working-days.test.ts`

- [ ] **Step 2.1: Write failing test for holidays.ts**

Create `src/lib/leaves/__tests__/holidays.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isLocalHoliday, isPublicHoliday } from "../holidays";

describe("isLocalHoliday", () => {
  it("returns true for San Feliciano 24/01 (any year)", () => {
    expect(isLocalHoliday("2026-01-24")).toBe(true);
    expect(isLocalHoliday("2027-01-24")).toBe(true);
    expect(isLocalHoliday("2030-01-24")).toBe(true);
  });

  it("returns false for non-local-holiday dates", () => {
    expect(isLocalHoliday("2026-01-23")).toBe(false);
    expect(isLocalHoliday("2026-01-25")).toBe(false);
    expect(isLocalHoliday("2026-12-25")).toBe(false); // Christmas is national, not local
  });
});

describe("isPublicHoliday", () => {
  it("returns true for Italian national holidays", () => {
    expect(isPublicHoliday("2026-01-01")).toBe(true); // Capodanno
    expect(isPublicHoliday("2026-04-25")).toBe(true); // Liberazione
    expect(isPublicHoliday("2026-05-01")).toBe(true); // Lavoro
    expect(isPublicHoliday("2026-08-15")).toBe(true); // Ferragosto
    expect(isPublicHoliday("2026-12-25")).toBe(true); // Natale
    expect(isPublicHoliday("2026-12-26")).toBe(true); // Santo Stefano
  });

  it("returns true for San Feliciano (local)", () => {
    expect(isPublicHoliday("2027-01-24")).toBe(true);
  });

  it("returns true for Easter and Easter Monday (movable)", () => {
    // Easter 2026 = 5 April, Easter Monday = 6 April
    expect(isPublicHoliday("2026-04-05")).toBe(true);
    expect(isPublicHoliday("2026-04-06")).toBe(true);
  });

  it("returns false for regular working days", () => {
    expect(isPublicHoliday("2026-05-21")).toBe(false);
    expect(isPublicHoliday("2026-03-15")).toBe(false);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npm test -- src/lib/leaves/__tests__/holidays.test.ts
```

Expected: FAIL with module-not-found error for `../holidays`.

- [ ] **Step 2.3: Create `src/lib/leaves/holidays.ts`**

```ts
/**
 * Holiday detection for the leave domain.
 *
 * Wraps `src/lib/holidays-it.ts` (Italian national holidays, computed
 * including Easter Monday via Meeus's algorithm) and adds local company
 * holidays. Today the only local holiday is San Feliciano (24 January,
 * patronale Foligno).
 */
import { getItalianHolidays } from "../holidays-it";

/** Local company holidays as "MM-DD" (recurring every year). */
const LOCAL_HOLIDAYS_MMDD = new Set<string>([
  "01-24", // San Feliciano (Foligno)
]);

/**
 * True if the date is a recurring local company holiday.
 * `date` must be in "YYYY-MM-DD" format.
 */
export function isLocalHoliday(date: string): boolean {
  return LOCAL_HOLIDAYS_MMDD.has(date.slice(5));
}

/**
 * True if the date is a non-working holiday (national + local).
 * Does NOT consider weekends — use working-days.ts for that.
 * `date` must be in "YYYY-MM-DD" format.
 */
export function isPublicHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  if (Number.isNaN(year)) return false;
  if (getItalianHolidays(year).has(date)) return true;
  return isLocalHoliday(date);
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npm test -- src/lib/leaves/__tests__/holidays.test.ts
```

Expected: PASS, all assertions green.

- [ ] **Step 2.5: Write failing test for working-days.ts**

Create `src/lib/leaves/__tests__/working-days.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { countWorkDays, expandToWorkingDays, isWorkingDay } from "../working-days";

// Full-time schedule (Mon-Fri all present)
const FULL_TIME = new Map<number, unknown>([
  [1, {}], [2, {}], [3, {}], [4, {}], [5, {}],
]);

// Part-time schedule (only Wed + Thu)
const PART_TIME_WT = new Map<number, unknown>([
  [3, {}], [4, {}],
]);

describe("isWorkingDay", () => {
  it("returns false for weekends regardless of schedule", () => {
    expect(isWorkingDay("2026-05-23", FULL_TIME)).toBe(false); // Sat
    expect(isWorkingDay("2026-05-24", FULL_TIME)).toBe(false); // Sun
  });

  it("returns false for national holidays on working days", () => {
    expect(isWorkingDay("2026-05-01", FULL_TIME)).toBe(false); // Fri 1/5 Festa Lavoro
    expect(isWorkingDay("2026-04-06", FULL_TIME)).toBe(false); // Mon Pasquetta
  });

  it("returns false for San Feliciano 24/01 (local) on a working day", () => {
    // 24/01/2028 is a Monday
    expect(isWorkingDay("2028-01-24", FULL_TIME)).toBe(false);
  });

  it("returns true for normal working days", () => {
    expect(isWorkingDay("2026-05-22", FULL_TIME)).toBe(true); // Fri
    expect(isWorkingDay("2026-05-25", FULL_TIME)).toBe(true); // Mon
  });

  it("returns false for days outside part-time schedule", () => {
    expect(isWorkingDay("2026-05-25", PART_TIME_WT)).toBe(false); // Mon, not in PT
    expect(isWorkingDay("2026-05-27", PART_TIME_WT)).toBe(true);  // Wed, in PT
    expect(isWorkingDay("2026-05-28", PART_TIME_WT)).toBe(true);  // Thu, in PT
  });
});

describe("countWorkDays", () => {
  it("counts only working days, excluding weekends in between (the bug case)", () => {
    // Fri 22/05/2026 → Mon 25/05/2026
    expect(countWorkDays("2026-05-22", "2026-05-25", FULL_TIME)).toBe(2);
  });

  it("excludes national holidays in the middle of the range", () => {
    // Thu 30/04 → Mon 04/05, Fri 01/05 is Festa Lavoro
    expect(countWorkDays("2026-04-30", "2026-05-04", FULL_TIME)).toBe(2);
  });

  it("does not double-penalize a holiday that falls on a weekend", () => {
    // 25/04/2026 is a Saturday (Festa Liberazione)
    // Fri 24/04 → Mon 27/04: only Fri + Mon count
    expect(countWorkDays("2026-04-24", "2026-04-27", FULL_TIME)).toBe(2);
  });

  it("returns 1 for a single working day", () => {
    expect(countWorkDays("2026-05-22", "2026-05-22", FULL_TIME)).toBe(1);
  });

  it("returns 0 for a single weekend day", () => {
    expect(countWorkDays("2026-05-23", "2026-05-23", FULL_TIME)).toBe(0);
  });

  it("returns 0 for inverted range", () => {
    expect(countWorkDays("2026-05-25", "2026-05-22", FULL_TIME)).toBe(0);
  });

  it("respects part-time schedule", () => {
    // Mon 25/05 → Fri 29/05: only Wed 27 + Thu 28 count for PT Wed+Thu
    expect(countWorkDays("2026-05-25", "2026-05-29", PART_TIME_WT)).toBe(2);
  });
});

describe("expandToWorkingDays", () => {
  it("returns only the working dates in the range", () => {
    const result = expandToWorkingDays("2026-05-22", "2026-05-25", FULL_TIME);
    expect(result).toEqual(["2026-05-22", "2026-05-25"]);
  });

  it("returns empty array for inverted range", () => {
    expect(expandToWorkingDays("2026-05-25", "2026-05-22", FULL_TIME)).toEqual([]);
  });
});
```

- [ ] **Step 2.6: Run test to verify it fails**

```bash
npm test -- src/lib/leaves/__tests__/working-days.test.ts
```

Expected: FAIL with module-not-found for `../working-days`.

- [ ] **Step 2.7: Create `src/lib/leaves/working-days.ts`**

```ts
/**
 * Pure working-day computation for the leave domain.
 *
 * `ScheduleMap` is built by callers from `EmployeeSchedule` rows.
 * Keys = ISO day of week (1=Mon..7=Sun). Today the schedule table only
 * stores rows for 1..5, so weekend days are absent → automatically excluded.
 * Holidays (national + local San Feliciano) add a second exclusion layer.
 *
 * All inputs are YYYY-MM-DD strings. No `new Date()` arithmetic for
 * iteration to avoid host-timezone drift; we use a UTC-anchored Date
 * at noon to compute day-of-week via Europe/Rome.
 */
import { dowRome } from "../tz";
import { isPublicHoliday } from "./holidays";

export type ScheduleMap = Map<number, unknown>;

/** Day of week in Europe/Rome (1=Mon..7=Sun) for a YYYY-MM-DD string. */
function dayOfWeekIso(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  // Anchor at noon UTC so the Europe/Rome calendar date matches `date`
  // regardless of DST and host TZ.
  return dowRome(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
}

/** Increment a YYYY-MM-DD by one day, returning a YYYY-MM-DD. */
function addOneDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + 1);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** True if the given calendar date counts as a working day for this employee. */
export function isWorkingDay(date: string, scheduleMap: ScheduleMap): boolean {
  const dow = dayOfWeekIso(date);
  if (!scheduleMap.has(dow)) return false;
  if (isPublicHoliday(date)) return false;
  return true;
}

/** Inclusive count of working days between two YYYY-MM-DD strings. */
export function countWorkDays(
  startDate: string,
  endDate: string,
  scheduleMap: ScheduleMap
): number {
  if (startDate > endDate) return 0;
  let count = 0;
  let cur = startDate;
  while (cur <= endDate) {
    if (isWorkingDay(cur, scheduleMap)) count++;
    cur = addOneDay(cur);
  }
  return count;
}

/** Inclusive list of working YYYY-MM-DD dates between two dates. */
export function expandToWorkingDays(
  startDate: string,
  endDate: string,
  scheduleMap: ScheduleMap
): string[] {
  if (startDate > endDate) return [];
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    if (isWorkingDay(cur, scheduleMap)) out.push(cur);
    cur = addOneDay(cur);
  }
  return out;
}
```

- [ ] **Step 2.8: Run test to verify it passes**

```bash
npm test -- src/lib/leaves/__tests__/working-days.test.ts
```

Expected: PASS, all assertions green.

- [ ] **Step 2.9: Commit**

```bash
git add src/lib/leaves/holidays.ts src/lib/leaves/working-days.ts src/lib/leaves/__tests__/holidays.test.ts src/lib/leaves/__tests__/working-days.test.ts
git commit -m "$(cat <<'EOF'
feat(leaves): extract working-days + holiday-aware count

New pure modules src/lib/leaves/{holidays,working-days}.ts.

holidays.ts wraps holidays-it.ts (national + Easter) and adds local
San Feliciano (24/01). working-days.ts iterates YYYY-MM-DD strings
without host-TZ drift and excludes both weekends (absent from
ScheduleMap) and isPublicHoliday dates.

Resolves user appunto #1 + audit C6 (holidays not subtracted from
vacation day count).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate `leaves.ts` → `leaves/balance.ts` with back-compat shim

**Files:**
- Create: `src/lib/leaves/balance.ts` (migrated content)
- Create: `src/lib/leaves/index.ts` (public re-export)
- Modify: `src/lib/leaves.ts` → becomes a 2-line re-export shim
- Modify: `src/lib/leaves.ts:263-277` content moved into balance.ts and switched to use working-days.ts

- [ ] **Step 3.1: Create `src/lib/leaves/balance.ts` with migrated content**

Create file with content equivalent to `src/lib/leaves.ts` BUT:
1. Remove the local `countWorkDays` definition (lines 263-277 of current `leaves.ts`).
2. Import `countWorkDays` from `./working-days`.
3. Build the `ScheduleMap` as `Map<number, unknown>` (the type that working-days expects) — note balance.ts internally still needs the full `ScheduleBlock` for hours calc, so keep both maps or use the existing one as `Map<number, ScheduleBlock>` and cast/pass when calling `countWorkDays` (Map covariance works fine since working-days only checks `.has`).
4. Keep `countCalendarDays` local in balance.ts (sick uses calendar days, no change).

Full content of `src/lib/leaves/balance.ts`:

```ts
import { prisma } from "../db";
import { countWorkDays } from "./working-days";

// ── Leave type definitions ──

export const LEAVE_TYPES = {
  VACATION: { label: "Ferie", unit: "days", scalesFrom: "vacation" },
  VACATION_HALF_AM: { label: "Ferie (mattina)", unit: "days", scalesFrom: "vacation" },
  VACATION_HALF_PM: { label: "Ferie (pomeriggio)", unit: "days", scalesFrom: "vacation" },
  ROL: { label: "Permesso orario (ROL)", unit: "hours", scalesFrom: "rol" },
  SICK: { label: "Malattia", unit: "days", scalesFrom: null },
  BEREAVEMENT: { label: "Lutto", unit: "hours", scalesFrom: "rol" },
  MARRIAGE: { label: "Matrimonio", unit: "hours", scalesFrom: "rol" },
  LAW_104: { label: "L. 104", unit: "hours", scalesFrom: "rol" },
  MEDICAL_VISIT: { label: "Visita medica", unit: "hours", scalesFrom: "rol" },
} as const;

export type LeaveType = keyof typeof LEAVE_TYPES;

// ── Accrual constants (CCNL Commercio) ──

const FULL_TIME_WEEKLY_HOURS = 40;
const VACATION_DAYS_PER_MONTH_FT = 2;
const ROL_HOURS_PER_MONTH_FT = 2;

// ── Weekly hours calculation ──

interface ScheduleBlock {
  block1Start: string | null;
  block1End: string | null;
  block2Start: string | null;
  block2End: string | null;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function blockHours(block: ScheduleBlock): number {
  let minutes = 0;
  if (block.block1Start && block.block1End) {
    minutes += timeToMinutes(block.block1End) - timeToMinutes(block.block1Start);
  }
  if (block.block2Start && block.block2End) {
    minutes += timeToMinutes(block.block2End) - timeToMinutes(block.block2Start);
  }
  return minutes / 60;
}

export function calcWeeklyHours(schedule: ScheduleBlock[]): number {
  return Math.round(schedule.reduce((sum, s) => sum + blockHours(s), 0) * 10) / 10;
}

export function calcDailyHours(_schedule: ScheduleBlock[], _dayOfWeek: number): number {
  return 0;
}

export function calcDailyHoursFromMap(
  scheduleMap: Map<number, ScheduleBlock>,
  dayOfWeek: number
): number {
  const day = scheduleMap.get(dayOfWeek);
  if (!day) return 0;
  return blockHours(day);
}

// ── Accrual proportioning ──

function getProportionRatio(weeklyHours: number): number {
  if (weeklyHours >= FULL_TIME_WEEKLY_HOURS) return 1;
  return weeklyHours / FULL_TIME_WEEKLY_HOURS;
}

export function monthlyVacationAccrual(weeklyHours: number): number {
  return Math.round(VACATION_DAYS_PER_MONTH_FT * getProportionRatio(weeklyHours) * 100) / 100;
}

export function monthlyRolAccrual(weeklyHours: number): number {
  return Math.round(ROL_HOURS_PER_MONTH_FT * getProportionRatio(weeklyHours) * 100) / 100;
}

// ── Balance computation ──

export interface LeaveBalanceSummary {
  vacationAccrued: number;
  vacationAccrualAdjust: number;
  vacationUsed: number;
  vacationCarryOver: number;
  vacationRemaining: number;
  vacationUsedThisMonth: number;
  rolAccrued: number;
  rolAccrualAdjust: number;
  rolUsed: number;
  rolCarryOver: number;
  rolRemaining: number;
  rolUsedThisMonth: number;
  sickDays: number;
  sickDaysThisMonth: number;
  weeklyHours: number;
  contractType: string;
}

export async function computeLeaveBalance(
  employeeId: string,
  year: number
): Promise<LeaveBalanceSummary> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { schedule: true },
  });

  if (!employee) {
    throw new Error("Dipendente non trovato");
  }

  const weeklyHours = employee.schedule.length > 0
    ? calcWeeklyHours(employee.schedule)
    : (employee.contractType === "FULL_TIME" ? FULL_TIME_WEEKLY_HOURS : 0);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  let monthsAccrued: number;
  const hireDate = employee.hireDate ? new Date(employee.hireDate) : null;

  if (hireDate && hireDate.getFullYear() === year) {
    const hireMonth = hireDate.getMonth();
    if (year === currentYear) {
      monthsAccrued = currentMonth - hireMonth + 1;
    } else if (year < currentYear) {
      monthsAccrued = 12 - hireMonth;
    } else {
      monthsAccrued = 0;
    }
  } else if (hireDate && hireDate.getFullYear() > year) {
    monthsAccrued = 0;
  } else {
    if (year === currentYear) {
      monthsAccrued = currentMonth + 1;
    } else if (year < currentYear) {
      monthsAccrued = 12;
    } else {
      monthsAccrued = 0;
    }
  }

  monthsAccrued = Math.max(0, Math.min(12, monthsAccrued));

  const vacationAccrued = Math.round(monthsAccrued * monthlyVacationAccrual(weeklyHours) * 100) / 100;
  const rolAccrued = Math.round(monthsAccrued * monthlyRolAccrual(weeklyHours) * 100) / 100;

  const balance = await prisma.leaveBalance.findUnique({
    where: { employeeId_year: { employeeId, year } },
  });
  const vacationCarryOver = balance?.vacationCarryOver ?? 0;
  const rolCarryOver = balance?.rolCarryOver ?? 0;
  const vacationAccrualAdjust = balance?.vacationAccrualAdjust ?? 0;
  const rolAccrualAdjust = balance?.rolAccrualAdjust ?? 0;

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const monthStart = `${year}-${String(currentMonth + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(currentMonth + 1).padStart(2, "0")}-31`;

  const approvedLeaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: "APPROVED",
      startDate: { gte: yearStart, lte: yearEnd },
    },
  });

  const scheduleMap = new Map<number, ScheduleBlock>();
  for (const s of employee.schedule) {
    scheduleMap.set(s.dayOfWeek, s);
  }

  let vacationUsed = 0;
  let vacationUsedThisMonth = 0;
  let rolUsed = 0;
  let rolUsedThisMonth = 0;
  let sickDays = 0;
  let sickDaysThisMonth = 0;

  for (const leave of approvedLeaves) {
    const type = leave.type as LeaveType;
    const isThisMonth = leave.startDate >= monthStart && leave.startDate <= monthEnd;

    if (type === "VACATION") {
      const days = countWorkDays(leave.startDate, leave.endDate, scheduleMap);
      vacationUsed += days;
      if (isThisMonth) vacationUsedThisMonth += days;
    } else if (type === "VACATION_HALF_AM" || type === "VACATION_HALF_PM") {
      vacationUsed += 0.5;
      if (isThisMonth) vacationUsedThisMonth += 0.5;
    } else if (type === "SICK") {
      const days = countCalendarDays(leave.startDate, leave.endDate);
      sickDays += days;
      if (isThisMonth) sickDaysThisMonth += days;
    } else {
      const hours = leave.hours ?? 0;
      rolUsed += hours;
      if (isThisMonth) rolUsedThisMonth += hours;
    }
  }

  return {
    vacationAccrued,
    vacationAccrualAdjust,
    vacationUsed: Math.round(vacationUsed * 100) / 100,
    vacationCarryOver,
    vacationRemaining:
      Math.round(
        (vacationCarryOver + vacationAccrued + vacationAccrualAdjust - vacationUsed) * 100
      ) / 100,
    vacationUsedThisMonth: Math.round(vacationUsedThisMonth * 100) / 100,
    rolAccrued,
    rolAccrualAdjust,
    rolUsed: Math.round(rolUsed * 100) / 100,
    rolCarryOver,
    rolRemaining:
      Math.round(
        (rolCarryOver + rolAccrued + rolAccrualAdjust - rolUsed) * 100
      ) / 100,
    rolUsedThisMonth: Math.round(rolUsedThisMonth * 100) / 100,
    sickDays,
    sickDaysThisMonth,
    weeklyHours,
    contractType: employee.contractType,
  };
}

// ── Helpers ──

function countCalendarDays(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export async function getLeaveForDate(
  employeeId: string,
  date: string
): Promise<{ type: LeaveType; hours?: number; timeSlots?: { from: string; to: string }[] } | null> {
  const leave = await prisma.leaveRequest.findFirst({
    where: {
      employeeId,
      status: "APPROVED",
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });

  if (!leave) return null;

  return {
    type: leave.type as LeaveType,
    hours: leave.hours ?? undefined,
    timeSlots: leave.timeSlots ? JSON.parse(leave.timeSlots) : undefined,
  };
}
```

- [ ] **Step 3.2: Create `src/lib/leaves/index.ts` re-export**

```ts
/**
 * Public surface of the leaves module.
 * Existing callsites still importing from `@/lib/leaves` keep working
 * via the shim at `src/lib/leaves.ts`.
 */
export * from "./balance";
export * from "./working-days";
export * from "./holidays";
```

- [ ] **Step 3.3: Replace `src/lib/leaves.ts` with shim**

Overwrite `src/lib/leaves.ts` entirely with:

```ts
/**
 * Back-compat shim. Source of truth moved to `src/lib/leaves/`.
 * This file will be removed once all callsites import from `@/lib/leaves/*`
 * (deferred cleanup phase per spec).
 */
export * from "./leaves/index";
```

- [ ] **Step 3.4: Type-check the project**

```bash
npx tsc --noEmit
```

Expected: no errors. All existing callsites (`import { LEAVE_TYPES } from "@/lib/leaves"`, etc.) keep resolving through the shim.

- [ ] **Step 3.5: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all existing tests still pass, plus the new working-days + holidays tests.

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/leaves.ts src/lib/leaves/balance.ts src/lib/leaves/index.ts
git commit -m "$(cat <<'EOF'
refactor(leaves): split monolith into leaves/ module (back-compat re-export)

Moves computeLeaveBalance + accrual helpers into src/lib/leaves/balance.ts.
`countWorkDays` removed from balance.ts; replaced by import from
src/lib/leaves/working-days.ts (now holiday-aware).

src/lib/leaves.ts becomes a one-line re-export shim so existing
@/lib/leaves imports continue to work. Cleanup deferred to a follow-up.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Validation module — Zod schemas + parseLeaveDates with PAST_DATE + type detection

**Files:**
- Create: `src/lib/leaves/validation.ts`
- Create: `src/lib/leaves/format.ts`
- Create: `src/lib/leaves/__tests__/validation.test.ts`
- Modify: `src/lib/leave-date-parser.ts` → shim
- Modify: `src/lib/leave-format.ts` → shim
- Modify: `src/lib/leaves/index.ts` (add new re-exports)

**Pre-requisite:** ensure `zod` is in dependencies. Check with:
```bash
node -e "console.log(require('./package.json').dependencies.zod || require('./package.json').devDependencies?.zod)"
```
If undefined, run:
```bash
npm install zod
```

- [ ] **Step 4.1: Write failing test for validation.ts**

Create `src/lib/leaves/__tests__/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  detectLeaveTypeFromSubject,
  parseLeaveDates,
  createLeaveSchema,
  editLeaveSchema,
} from "../validation";

describe("detectLeaveTypeFromSubject", () => {
  it("detects VACATION from 'ferie'", () => {
    expect(detectLeaveTypeFromSubject("ferie")).toBe("VACATION");
    expect(detectLeaveTypeFromSubject("Re: Fwd: Richiesta ferie estate")).toBe("VACATION");
  });

  it("detects ROL from 'rol' or 'permesso'", () => {
    expect(detectLeaveTypeFromSubject("ROL del 22/05")).toBe("ROL");
    expect(detectLeaveTypeFromSubject("permesso visita")).toBe("ROL");
  });

  it("detects SICK from 'malattia'", () => {
    expect(detectLeaveTypeFromSubject("malattia 3 giorni")).toBe("SICK");
  });

  it("detects BEREAVEMENT, MARRIAGE, LAW_104, MEDICAL_VISIT", () => {
    expect(detectLeaveTypeFromSubject("Lutto familiare")).toBe("BEREAVEMENT");
    expect(detectLeaveTypeFromSubject("matrimonio 15/06")).toBe("MARRIAGE");
    expect(detectLeaveTypeFromSubject("legge 104")).toBe("LAW_104");
    expect(detectLeaveTypeFromSubject("visita medica")).toBe("MEDICAL_VISIT");
  });

  it("returns null when no keyword matches", () => {
    expect(detectLeaveTypeFromSubject("ciao come va")).toBeNull();
    expect(detectLeaveTypeFromSubject("")).toBeNull();
  });

  it("strips Re:/Fwd: prefixes case-insensitively", () => {
    expect(detectLeaveTypeFromSubject("RE: re: FWD: ferie")).toBe("VACATION");
  });
});

describe("parseLeaveDates", () => {
  it("parses 'DAL gg/mm AL gg/mm' with current year", () => {
    const r = parseLeaveDates("DAL 22/05 AL 25/05", "2026-05-20");
    expect(r).toEqual({ ok: true, startDate: "2026-05-22", endDate: "2026-05-25" });
  });

  it("rejects when start is in the past more than 7 days", () => {
    const r = parseLeaveDates("DAL 15/04 AL 18/04", "2026-12-20");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("PAST_DATE");
  });

  it("accepts dates within 7-day back-date tolerance", () => {
    // Mon 2026-05-25, request says Fri 2026-05-22 — backdated by 3 days
    const r = parseLeaveDates("DAL 22/05 AL 22/05", "2026-05-25");
    expect(r.ok).toBe(true);
  });

  it("rejects inverted range as INVALID_RANGE", () => {
    const r = parseLeaveDates("DAL 25/05 AL 22/05", "2026-05-20");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_RANGE");
  });

  it("returns PARSE_ERROR for unrecognized input", () => {
    const r = parseLeaveDates("ciao mondo", "2026-05-20");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("PARSE_ERROR");
  });

  it("respects explicit year when provided", () => {
    const r = parseLeaveDates("DAL 22/05/2027 AL 25/05/2027", "2026-05-20");
    expect(r).toEqual({ ok: true, startDate: "2027-05-22", endDate: "2027-05-25" });
  });
});

describe("createLeaveSchema (Zod)", () => {
  it("accepts valid VACATION input", () => {
    const r = createLeaveSchema.safeParse({
      employeeId: "emp_1",
      type: "VACATION",
      startDate: "2026-05-22",
      endDate: "2026-05-25",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid type", () => {
    const r = createLeaveSchema.safeParse({
      employeeId: "emp_1",
      type: "BOGUS",
      startDate: "2026-05-22",
      endDate: "2026-05-25",
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative hours", () => {
    const r = createLeaveSchema.safeParse({
      employeeId: "emp_1",
      type: "ROL",
      startDate: "2026-05-22",
      endDate: "2026-05-22",
      hours: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects notes longer than 2000 chars", () => {
    const r = createLeaveSchema.safeParse({
      employeeId: "emp_1",
      type: "VACATION",
      startDate: "2026-05-22",
      endDate: "2026-05-25",
      notes: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });
});

describe("editLeaveSchema (Zod)", () => {
  it("requires version for edit operations", () => {
    const r = editLeaveSchema.safeParse({
      startDate: "2026-05-22",
      endDate: "2026-05-25",
    });
    expect(r.success).toBe(false);
  });

  it("accepts partial fields with version", () => {
    const r = editLeaveSchema.safeParse({
      version: 0,
      startDate: "2026-05-22",
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npm test -- src/lib/leaves/__tests__/validation.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 4.3: Create `src/lib/leaves/validation.ts`**

```ts
/**
 * Input validation + parsing for the leaves domain.
 *
 * Consolidates the old `leave-date-parser.ts` with type detection from
 * email subject and Zod schemas for create/edit payloads.
 */
import { z } from "zod";
import { LEAVE_TYPES } from "./balance";

const LEAVE_TYPE_VALUES = Object.keys(LEAVE_TYPES) as Array<keyof typeof LEAVE_TYPES>;

// ── Type detection from email subject ──

const TYPE_KEYWORDS: Array<readonly [RegExp, string]> = [
  // Order matters: more specific patterns first.
  [/\bvisit[ae]\s+medic[ao]\b|\bmedical[ei]\b/i,   "MEDICAL_VISIT"],
  [/\b(?:legge\s+)?104\b/i,                         "LAW_104"],
  [/\bmatrimoni[oi]\b/i,                            "MARRIAGE"],
  [/\blutt[oi]\b/i,                                 "BEREAVEMENT"],
  [/\bmalatti[ae]\b|\binfortuni[oi]\b/i,            "SICK"],
  [/\brol\b|\bpermess[oi]\b/i,                      "ROL"],
  [/\bferi[ea]\b/i,                                 "VACATION"],
];

function stripReplyForwardPrefixes(subject: string): string {
  return subject.replace(/^(?:\s*(?:re|fwd|fw|r):\s*)+/i, "").trim();
}

export function detectLeaveTypeFromSubject(subject: string): string | null {
  const cleaned = stripReplyForwardPrefixes(subject);
  if (!cleaned) return null;
  for (const [re, type] of TYPE_KEYWORDS) {
    if (re.test(cleaned)) return type;
  }
  return null;
}

// ── parseLeaveDates with PAST_DATE rejection ──

const PAST_DATE_TOLERANCE_DAYS = 7;

export type ParseDatesResult =
  | { ok: true; startDate: string; endDate: string }
  | { ok: false; reason: "PAST_DATE" | "PARSE_ERROR" | "INVALID_RANGE"; detail?: string };

function buildDate(dd: string, mm: string, yyyy: string | undefined, fallbackYear: number): string | null {
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  let year: number;
  if (yyyy) {
    year = parseInt(yyyy, 10);
    if (year < 100) year += 2000;
  } else {
    year = fallbackYear;
  }
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((ta - tb) / (1000 * 60 * 60 * 24));
}

export function parseLeaveDates(input: string, refDate: string): ParseDatesResult {
  const cleaned = input.trim().replace(/\s+/g, " ");
  if (!cleaned) return { ok: false, reason: "PARSE_ERROR" };

  const fallbackYear = Number(refDate.slice(0, 4));

  const re1 = /dal\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+al\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i;
  const re2 = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:-|al|→)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i;
  const re3 = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;

  let start: string | null = null;
  let end: string | null = null;

  const m1 = cleaned.match(re1);
  if (m1) {
    start = buildDate(m1[1], m1[2], m1[3], fallbackYear);
    end = buildDate(m1[4], m1[5], m1[6], fallbackYear);
  } else {
    const m2 = cleaned.match(re2);
    if (m2) {
      start = buildDate(m2[1], m2[2], m2[3], fallbackYear);
      end = buildDate(m2[4], m2[5], m2[6], fallbackYear);
    } else {
      const m3 = cleaned.match(re3);
      if (m3) {
        const single = buildDate(m3[1], m3[2], m3[3], fallbackYear);
        start = single;
        end = single;
      }
    }
  }

  if (!start || !end) return { ok: false, reason: "PARSE_ERROR" };

  if (start > end) {
    return { ok: false, reason: "INVALID_RANGE", detail: `${start} > ${end}` };
  }

  // PAST_DATE check: start older than refDate by more than tolerance.
  const daysOld = diffDays(refDate, start);
  if (daysOld > PAST_DATE_TOLERANCE_DAYS) {
    return { ok: false, reason: "PAST_DATE", detail: `start=${start} is ${daysOld} days before ${refDate}` };
  }

  return { ok: true, startDate: start, endDate: end };
}

// ── Zod schemas for API input ──

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (YYYY-MM-DD)");

const timeSlotSchema = z.object({
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
});

export const createLeaveSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(LEAVE_TYPE_VALUES as [string, ...string[]]),
  startDate: dateString,
  endDate: dateString,
  hours: z.number().min(0).max(24).optional().nullable(),
  timeSlots: z.array(timeSlotSchema).max(10).optional().nullable(),
  sickProtocol: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  confirmOverride: z.boolean().optional(),
}).refine(d => d.startDate <= d.endDate, {
  message: "startDate must be <= endDate",
  path: ["endDate"],
});

export const editLeaveSchema = z.object({
  version: z.number().int().min(0),
  type: z.enum(LEAVE_TYPE_VALUES as [string, ...string[]]).optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  hours: z.number().min(0).max(24).optional().nullable(),
  timeSlots: z.array(timeSlotSchema).max(10).optional().nullable(),
  sickProtocol: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  reason: z.string().max(500).optional(),
  confirmOverride: z.boolean().optional(),
});

export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
export type EditLeaveInput = z.infer<typeof editLeaveSchema>;
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
npm test -- src/lib/leaves/__tests__/validation.test.ts
```

Expected: PASS.

- [ ] **Step 4.5: Create `src/lib/leaves/format.ts`**

```ts
/**
 * Display formatting helpers for the leaves domain.
 * Migrated from src/lib/leave-format.ts. Existing import path kept as
 * a re-export shim in the original file.
 */

export function formatItDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-");
  return `${d}/${m}/${y}`;
}

// Re-export anything else the original leave-format.ts had.
// (At time of writing: only formatItDate. If more functions exist there,
// move them here verbatim.)
```

- [ ] **Step 4.6: Replace `src/lib/leave-format.ts` with shim**

```ts
/**
 * Back-compat shim. Source moved to src/lib/leaves/format.ts.
 */
export * from "./leaves/format";
```

**Important:** before overwriting, verify the original `leave-format.ts` only contains exports already covered by `leaves/format.ts`. If it has additional exports, copy them into `leaves/format.ts` first.

```bash
cat src/lib/leave-format.ts
```

If output shows only `formatItDate` (or what you already moved), proceed with the overwrite. If it has more, port them into `leaves/format.ts` first then overwrite.

- [ ] **Step 4.7: Replace `src/lib/leave-date-parser.ts` with shim**

The original `parseLeaveDates(input)` (no refDate, returned `null` on failure) had a different signature than the new `parseLeaveDates(input, refDate)`. Replace `src/lib/leave-date-parser.ts` with:

```ts
/**
 * Back-compat shim. parseLeaveDates moved to src/lib/leaves/validation.ts
 * with a new discriminated-union return type and a required refDate arg.
 *
 * Direct callers of the legacy signature must be migrated to the new
 * `parseLeaveDates(input, refDate)` from `@/lib/leaves/validation`.
 */
export { formatItDate } from "./leaves/format";
export { parseLeaveDates } from "./leaves/validation";
```

- [ ] **Step 4.8: Search and migrate legacy callers of `parseLeaveDates`**

```bash
grep -rn "from .*leave-date-parser\|from .*leaves.*parseLeaveDates" src/ --include="*.ts" --include="*.tsx"
```

For each match, update the call to use the new signature: `parseLeaveDates(input, todayRome())` (import `todayRome` from `@/lib/tz`). Sites likely affected per audit context: `src/lib/mail-ingest.ts`, `src/lib/telegram-handlers.ts`.

**Per file changed:** update the call site AND update the handling of the return value — old code expected `null` on failure, new code returns discriminated union.

Example transformation:

```ts
// BEFORE
const parsed = parseLeaveDates(body);
if (!parsed) { /* error reply */ return; }
const { startDate, endDate } = parsed;

// AFTER
const parsed = parseLeaveDates(body, todayRome());
if (!parsed.ok) {
  if (parsed.reason === "PAST_DATE") { /* PAST_DATE specific reply */ }
  else { /* generic parse error reply */ }
  return;
}
const { startDate, endDate } = parsed;
```

Apply the bare minimum change at each callsite — full email-ingest type-detection refactor lands in Task 10.

- [ ] **Step 4.9: Update `src/lib/leaves/index.ts` to re-export validation**

Append to `src/lib/leaves/index.ts`:

```ts
export * from "./validation";
export * from "./format";
```

- [ ] **Step 4.10: Type-check + run all tests**

```bash
npx tsc --noEmit
npm test
```

Expected: no TS errors; all tests pass (existing + new validation tests).

- [ ] **Step 4.11: Commit**

```bash
git add src/lib/leaves/validation.ts src/lib/leaves/format.ts src/lib/leaves/index.ts src/lib/leaves/__tests__/validation.test.ts src/lib/leave-date-parser.ts src/lib/leave-format.ts src/lib/mail-ingest.ts src/lib/telegram-handlers.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(leaves): zod validation + past-date parser

New src/lib/leaves/validation.ts exports:
- detectLeaveTypeFromSubject (regex priority list)
- parseLeaveDates(input, refDate) with discriminated PAST_DATE result
- createLeaveSchema / editLeaveSchema Zod schemas

leave-date-parser.ts and leave-format.ts become re-export shims.
mail-ingest.ts + telegram-handlers.ts adapted to the new return shape;
full type-detection refactor follows in a later commit.

Resolves audit M7 (past-date silent acceptance).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Overlap detection + integration into creation paths

**Files:**
- Create: `src/lib/leaves/overlap.ts`
- Create: `src/lib/leaves/__tests__/overlap.test.ts`
- Modify: `src/app/api/leaves/route.ts` (POST: + zod + overlap)
- Modify: `src/app/api/external/leaves/route.ts` (employee lookup precedence + zod + overlap)
- Modify: `src/lib/leaves/index.ts` (re-export overlap)

- [ ] **Step 5.1: Write failing test for overlap classifier**

Create `src/lib/leaves/__tests__/overlap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyOverlap, type ExistingLeaveConflict } from "../overlap";

function makeConflict(partial: Partial<ExistingLeaveConflict>): ExistingLeaveConflict {
  return {
    id: "x",
    type: "VACATION",
    status: "APPROVED",
    startDate: "2026-05-22",
    endDate: "2026-05-22",
    hours: null,
    timeSlots: null,
    overlappingDays: ["2026-05-22"],
    ...partial,
  };
}

describe("classifyOverlap", () => {
  it("BLOCK on VACATION + VACATION same day", () => {
    const r = classifyOverlap(
      { type: "VACATION", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "VACATION" })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("OK on VACATION_HALF_AM + VACATION_HALF_PM same day", () => {
    const r = classifyOverlap(
      { type: "VACATION_HALF_AM", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "VACATION_HALF_PM" })]
    );
    expect(r.kind).toBe("OK");
  });

  it("BLOCK on VACATION (full) + ROL same day", () => {
    const r = classifyOverlap(
      { type: "ROL", startDate: "2026-05-22", endDate: "2026-05-22", hours: 3 },
      [makeConflict({ type: "VACATION" })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("OK on VACATION_HALF_AM + ROL in afternoon", () => {
    const r = classifyOverlap(
      { type: "ROL", startDate: "2026-05-22", endDate: "2026-05-22", timeSlots: '[{"from":"14:30","to":"16:30"}]' },
      [makeConflict({ type: "VACATION_HALF_AM" })]
    );
    expect(r.kind).toBe("OK");
  });

  it("REQUIRES_CONFIRM on SICK over existing VACATION APPROVED", () => {
    const r = classifyOverlap(
      { type: "SICK", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "VACATION" })]
    );
    expect(r.kind).toBe("REQUIRES_CONFIRM");
  });

  it("BLOCK on SICK + SICK same day", () => {
    const r = classifyOverlap(
      { type: "SICK", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "SICK" })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("BLOCK on VACATION over existing SICK", () => {
    const r = classifyOverlap(
      { type: "VACATION", startDate: "2026-05-22", endDate: "2026-05-22" },
      [makeConflict({ type: "SICK" })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("BLOCK on any over BEREAVEMENT/MARRIAGE/LAW_104/MEDICAL_VISIT", () => {
    for (const oneOff of ["BEREAVEMENT", "MARRIAGE", "LAW_104", "MEDICAL_VISIT"]) {
      const r = classifyOverlap(
        { type: "VACATION", startDate: "2026-05-22", endDate: "2026-05-22" },
        [makeConflict({ type: oneOff })]
      );
      expect(r.kind).toBe("BLOCK");
    }
  });

  it("ROL + ROL: BLOCK on overlapping timeSlots", () => {
    const r = classifyOverlap(
      { type: "ROL", startDate: "2026-05-22", endDate: "2026-05-22", timeSlots: '[{"from":"09:00","to":"11:00"}]' },
      [makeConflict({ type: "ROL", timeSlots: '[{"from":"10:00","to":"12:00"}]' })]
    );
    expect(r.kind).toBe("BLOCK");
  });

  it("ROL + ROL: OK on disjoint timeSlots", () => {
    const r = classifyOverlap(
      { type: "ROL", startDate: "2026-05-22", endDate: "2026-05-22", timeSlots: '[{"from":"09:00","to":"10:00"}]' },
      [makeConflict({ type: "ROL", timeSlots: '[{"from":"15:00","to":"16:00"}]' })]
    );
    expect(r.kind).toBe("OK");
  });

  it("returns OK when no conflicts provided", () => {
    const r = classifyOverlap(
      { type: "VACATION", startDate: "2026-05-22", endDate: "2026-05-22" },
      []
    );
    expect(r.kind).toBe("OK");
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
npm test -- src/lib/leaves/__tests__/overlap.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 5.3: Create `src/lib/leaves/overlap.ts`**

```ts
/**
 * Overlap detection across all leave creation paths.
 *
 * `classifyOverlap` is pure (no Prisma) — feed it the new request and
 * the list of existing intersecting leaves. `checkOverlap` is the
 * convenience wrapper that runs the Prisma query + classifier.
 */
import { prisma } from "../db";

export type OverlapKind = "BLOCK" | "REQUIRES_CONFIRM" | "OK";

export interface ExistingLeaveConflict {
  id: string;
  type: string;
  status: string; // APPROVED | PENDING
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
  overlappingDays: string[];
}

export interface NewLeaveCandidate {
  type: string;
  startDate: string;
  endDate: string;
  hours?: number | null;
  timeSlots?: string | null;
}

export interface OverlapResult {
  kind: OverlapKind;
  conflicts: ExistingLeaveConflict[];
  reason?: string;
}

const ONE_OFF_TYPES = new Set(["BEREAVEMENT", "MARRIAGE", "LAW_104", "MEDICAL_VISIT"]);

function isVacationFull(type: string): boolean {
  return type === "VACATION";
}

function isVacationHalfAM(type: string): boolean {
  return type === "VACATION_HALF_AM";
}

function isVacationHalfPM(type: string): boolean {
  return type === "VACATION_HALF_PM";
}

function parseSlots(json: string | null | undefined): Array<{ from: string; to: string }> {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

function slotsOverlap(a: Array<{ from: string; to: string }>, b: Array<{ from: string; to: string }>): boolean {
  for (const x of a) for (const y of b) {
    if (x.from < y.to && y.from < x.to) return true;
  }
  return false;
}

function classifyPair(neu: NewLeaveCandidate, existing: ExistingLeaveConflict): OverlapKind {
  const e = existing.type;
  const n = neu.type;

  // SICK arriving over non-SICK APPROVED → admin confirms.
  if (n === "SICK" && e !== "SICK" && existing.status === "APPROVED") {
    return "REQUIRES_CONFIRM";
  }

  // SICK over SICK → BLOCK (dedup).
  if (n === "SICK" && e === "SICK") return "BLOCK";

  // VACATION/ROL/etc arriving on a day already SICK → BLOCK.
  if (e === "SICK" && n !== "SICK") return "BLOCK";

  // One-off events (BEREAVEMENT/MARRIAGE/LAW_104/MEDICAL_VISIT) block anything else intersecting.
  if (ONE_OFF_TYPES.has(e) || ONE_OFF_TYPES.has(n)) return "BLOCK";

  // VACATION-family vs VACATION-family same day(s).
  const eIsVacation = isVacationFull(e) || isVacationHalfAM(e) || isVacationHalfPM(e);
  const nIsVacation = isVacationFull(n) || isVacationHalfAM(n) || isVacationHalfPM(n);
  if (eIsVacation && nIsVacation) {
    // Allow HALF_AM + HALF_PM combo same day; everything else blocks.
    if ((isVacationHalfAM(e) && isVacationHalfPM(n)) || (isVacationHalfPM(e) && isVacationHalfAM(n))) {
      return "OK";
    }
    return "BLOCK";
  }

  // VACATION (full) + ROL/permesso same day → BLOCK (incoherent).
  if (isVacationFull(e) && n === "ROL") return "BLOCK";
  if (isVacationFull(n) && e === "ROL") return "BLOCK";

  // VACATION_HALF_AM + ROL — OK only if ROL slots fall outside AM.
  // For simplicity here: if either side is half-day, OK (the half-day
  // is enforced as a balance unit; ROL is hourly). Detailed slot check
  // would require knowing AM/PM cutover time; deferred. This is a
  // conservative-OK consistent with spec sec 6 rows 4-5.
  if ((isVacationHalfAM(e) || isVacationHalfPM(e)) && n === "ROL") return "OK";
  if ((isVacationHalfAM(n) || isVacationHalfPM(n)) && e === "ROL") return "OK";

  // ROL + ROL — check timeSlots intersection.
  if (e === "ROL" && n === "ROL") {
    const aSlots = parseSlots(neu.timeSlots);
    const bSlots = parseSlots(existing.timeSlots);
    if (aSlots.length === 0 || bSlots.length === 0) return "BLOCK"; // worst case
    return slotsOverlap(aSlots, bSlots) ? "BLOCK" : "OK";
  }

  // Fallback (unknown combo): BLOCK conservatively.
  return "BLOCK";
}

export function classifyOverlap(neu: NewLeaveCandidate, existing: ExistingLeaveConflict[]): OverlapResult {
  if (existing.length === 0) return { kind: "OK", conflicts: [] };

  let worst: OverlapKind = "OK";
  for (const ex of existing) {
    const verdict = classifyPair(neu, ex);
    if (verdict === "BLOCK") { worst = "BLOCK"; break; }
    if (verdict === "REQUIRES_CONFIRM" && worst !== "BLOCK") worst = "REQUIRES_CONFIRM";
  }

  return {
    kind: worst,
    conflicts: existing,
    reason: worst === "BLOCK"
      ? `Conflitto con richiesta esistente (${existing[0].type} ${existing[0].startDate}-${existing[0].endDate})`
      : undefined,
  };
}

export async function checkOverlap(
  employeeId: string,
  request: NewLeaveCandidate,
  options: { excludeId?: string } = {}
): Promise<OverlapResult> {
  const rows = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ["APPROVED", "PENDING"] },
      startDate: { lte: request.endDate },
      endDate: { gte: request.startDate },
      ...(options.excludeId ? { NOT: { id: options.excludeId } } : {}),
    },
  });

  // Compute intersecting days for each row (inclusive bounds).
  const existing: ExistingLeaveConflict[] = rows.map(r => ({
    id: r.id,
    type: r.type,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    hours: r.hours ?? null,
    timeSlots: r.timeSlots ?? null,
    overlappingDays: [], // not computed here; classifier doesn't need it
  }));

  return classifyOverlap(request, existing);
}
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
npm test -- src/lib/leaves/__tests__/overlap.test.ts
```

Expected: PASS.

- [ ] **Step 5.5: Update `src/lib/leaves/index.ts`**

Append:

```ts
export * from "./overlap";
```

- [ ] **Step 5.6: Integrate into `src/app/api/leaves/route.ts` POST**

Replace the body of the POST handler (current lines 71-195). New flow:
1. Parse + validate body via `createLeaveSchema`.
2. Resolve `employeeId` for EMPLOYEE role (as today).
3. `checkOverlap` → on BLOCK/REQUIRES_CONFIRM without `confirmOverride`, return 409 with structured error.
4. Create LeaveRequest (existing logic for source/status/approve).

Full replacement for the POST function:

```ts
export async function POST(request: NextRequest) {
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;

  try {
    const session = await auth();
    const rawBody = await request.json();

    // For EMPLOYEE role, override employeeId before validation.
    let resolvedEmployeeId: string | undefined = rawBody.employeeId;
    if (authResult.role === "EMPLOYEE") {
      resolvedEmployeeId = (await resolveEmployeeId(authResult)) ?? undefined;
    }
    const bodyForValidation = { ...rawBody, employeeId: resolvedEmployeeId };

    const parsed = createLeaveSchema.safeParse(bodyForValidation);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const isAdmin = authResult.role === "ADMIN";

    // Verify employee exists.
    const employee = await prisma.employee.findUnique({ where: { id: body.employeeId } });
    if (!employee) {
      return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
    }

    // Overlap check.
    const overlap = await checkOverlap(body.employeeId, {
      type: body.type,
      startDate: body.startDate,
      endDate: body.endDate,
      hours: body.hours ?? null,
      timeSlots: body.timeSlots ? JSON.stringify(body.timeSlots) : null,
    });

    if (overlap.kind === "BLOCK") {
      return NextResponse.json(
        { error: "OVERLAP_BLOCK", conflicts: overlap.conflicts, reason: overlap.reason },
        { status: 409 }
      );
    }
    if (overlap.kind === "REQUIRES_CONFIRM" && !(isAdmin && body.confirmOverride)) {
      return NextResponse.json(
        { error: "OVERLAP_REQUIRES_CONFIRM", conflicts: overlap.conflicts },
        { status: 409 }
      );
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: body.employeeId,
        type: body.type,
        startDate: body.startDate,
        endDate: body.endDate,
        hours: body.hours ?? null,
        timeSlots: body.timeSlots ? JSON.stringify(body.timeSlots) : null,
        sickProtocol: body.sickProtocol ?? null,
        notes: body.notes ?? null,
        status: isAdmin ? "APPROVED" : "PENDING",
        source: isAdmin ? "MANAGER" : "EXTERNAL_API",
        approvedById: isAdmin ? (session?.user?.id ?? null) : null,
        approvedAt: isAdmin ? new Date() : null,
      },
      include: { employee: true },
    });

    const employeeName = leave.employee.displayName || leave.employee.name;
    const typeLabel = LEAVE_TYPES[leave.type as LeaveType]?.label ?? leave.type;

    if (!isAdmin) {
      void notifyAdminsOfPendingLeave({
        employeeId: leave.employeeId,
        employeeName,
        type: leave.type,
        startDate: leave.startDate,
        endDate: leave.endDate,
        hours: leave.hours,
        notes: leave.notes,
      });
    } else {
      try {
        notificationsBus.publish({
          employeeId: leave.employeeId,
          employeeName,
          action: "LEAVE_APPROVED",
          time: typeLabel,
          date: leave.startDate,
          details: {
            leaveId: leave.id,
            leaveType: leave.type,
            leaveStartDate: leave.startDate,
            leaveEndDate: leave.endDate,
          },
        });
      } catch (err) {
        console.error("[leaves/POST] bus publish failed:", err);
      }
    }

    return NextResponse.json({
      id: leave.id,
      employeeId: leave.employeeId,
      employeeName,
      type: leave.type,
      typeLabel,
      startDate: leave.startDate,
      endDate: leave.endDate,
      hours: leave.hours,
      status: leave.status,
      source: leave.source,
      createdAt: leave.createdAt.toISOString(),
    }, { status: 201 });
  } catch (err) {
    console.error("Leave creation error:", err);
    const message = err instanceof Error ? err.message : "Errore nella creazione della richiesta";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

Add new imports at the top of the file:

```ts
import { createLeaveSchema } from "@/lib/leaves/validation";
import { checkOverlap } from "@/lib/leaves/overlap";
```

- [ ] **Step 5.7: Integrate into `src/app/api/external/leaves/route.ts`**

Read the current file:

```bash
cat src/app/api/external/leaves/route.ts | head -120
```

Apply two changes:

(a) **Replace the employee lookup** (around the `findFirst({ where: { OR: [{name}, {displayName}] } })` block) with precedence-based resolution:

```ts
// Employee resolution precedence: payrollId > email > name.
let employee = null;
if (body.payrollId) {
  employee = await prisma.employee.findUnique({ where: { payrollId: body.payrollId } });
}
if (!employee && body.employeeEmail) {
  employee = await prisma.employee.findUnique({ where: { email: body.employeeEmail } });
}
if (!employee && body.employeeName) {
  const matches = await prisma.employee.findMany({
    where: { OR: [{ name: body.employeeName }, { displayName: body.employeeName }] },
  });
  if (matches.length > 1) {
    return NextResponse.json(
      { error: "AMBIGUOUS_EMPLOYEE", count: matches.length },
      { status: 409 }
    );
  }
  employee = matches[0] ?? null;
}
if (!employee) {
  return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
}
```

(b) **Add overlap check** before `prisma.leaveRequest.create`:

```ts
const overlap = await checkOverlap(employee.id, {
  type, startDate, endDate, hours: hours ?? null, timeSlots: timeSlots ?? null,
});
if (overlap.kind !== "OK") {
  return NextResponse.json(
    { error: overlap.kind === "BLOCK" ? "OVERLAP_BLOCK" : "OVERLAP_REQUIRES_CONFIRM",
      conflicts: overlap.conflicts },
    { status: 409 }
  );
}
```

Add at the top:

```ts
import { checkOverlap } from "@/lib/leaves/overlap";
```

**Note:** input validation via Zod for this external endpoint is deferred — current ad-hoc validation stays. A future security hardening phase will add full schema validation including length caps (audit M1).

- [ ] **Step 5.8: Type-check + run tests + manual API smoke**

```bash
npx tsc --noEmit
npm test
```

Expected: all green.

Manual smoke (start dev server):

```bash
npm run dev
```

In a separate shell, log in as admin (cookie copy from browser) and try POST `/api/leaves` with an overlapping range. Expect 409 with `OVERLAP_BLOCK`. Then create a SICK over an existing VACATION — expect 409 with `OVERLAP_REQUIRES_CONFIRM`. Then retry with `confirmOverride: true` — expect 201.

(Manual smoke is optional but recommended; tests cover the classifier.)

- [ ] **Step 5.9: Commit**

```bash
git add src/lib/leaves/overlap.ts src/lib/leaves/__tests__/overlap.test.ts src/lib/leaves/index.ts src/app/api/leaves/route.ts src/app/api/external/leaves/route.ts
git commit -m "$(cat <<'EOF'
feat(leaves): overlap detection across creation paths

New src/lib/leaves/overlap.ts: classifyOverlap (pure decision matrix
per spec sec 6) + checkOverlap (Prisma wrapper). Hard-block same-type
overlap, REQUIRES_CONFIRM on SICK over non-SICK APPROVED.

Integrated into POST /api/leaves and /api/external/leaves. The latter
also gets explicit employee-lookup precedence (payrollId > email >
name uniqueness) to close audit C2 mis-routing.

Resolves audit H3 (overlap not checked).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Audit + edit-service + polymorphic PUT + GET /edits

**Files:**
- Create: `src/lib/leaves/audit.ts`
- Create: `src/lib/leaves/edit-service.ts`
- Create: `src/lib/leaves/__tests__/audit.test.ts`
- Create: `src/lib/leaves/__tests__/edit-service.test.ts`
- Create: `src/app/api/leaves/[id]/edits/route.ts`
- Modify: `src/app/api/leaves/[id]/route.ts` (polymorphic PUT)
- Modify: `src/lib/leaves/index.ts` (re-export)

- [ ] **Step 6.1: Write failing test for audit.ts**

Create `src/lib/leaves/__tests__/audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDiff, formatDiffForNotification } from "../audit";

const baseLeave = {
  id: "lr_1",
  employeeId: "emp_1",
  type: "VACATION",
  startDate: "2026-05-22",
  endDate: "2026-05-23",
  hours: null as number | null,
  timeSlots: null as string | null,
  sickProtocol: null as string | null,
  notes: null as string | null,
  status: "APPROVED",
};

describe("computeDiff", () => {
  it("returns empty changedFields when nothing changed", () => {
    const d = computeDiff(baseLeave, { ...baseLeave });
    expect(d.changedFields).toEqual([]);
  });

  it("captures startDate change only", () => {
    const next = { ...baseLeave, startDate: "2026-05-25", endDate: "2026-05-26" };
    const d = computeDiff(baseLeave, next);
    expect(d.changedFields.sort()).toEqual(["endDate", "startDate"]);
    expect(d.changes.startDate).toEqual({ old: "2026-05-22", new: "2026-05-25" });
  });

  it("captures type change", () => {
    const next = { ...baseLeave, type: "ROL", hours: 3 };
    const d = computeDiff(baseLeave, next);
    expect(d.changedFields).toContain("type");
    expect(d.changedFields).toContain("hours");
  });

  it("ignores fields outside the watched list", () => {
    const d = computeDiff({ ...baseLeave, employeeId: "emp_1" }, { ...baseLeave, employeeId: "emp_2" });
    expect(d.changedFields).toEqual([]);
  });
});

describe("formatDiffForNotification", () => {
  it("produces an Italian body summarizing changes", () => {
    const diff = computeDiff(baseLeave, { ...baseLeave, startDate: "2026-05-25", endDate: "2026-05-26" });
    const out = formatDiffForNotification(diff, "it");
    expect(out.subject).toMatch(/modificata/i);
    expect(out.body).toMatch(/22\/05\/2026.*25\/05\/2026/);
    expect(out.telegramBody.length).toBeGreaterThan(0);
  });

  it("includes only changed lines", () => {
    const diff = computeDiff(baseLeave, { ...baseLeave, notes: "nuova nota" });
    const out = formatDiffForNotification(diff, "it");
    expect(out.body).toMatch(/Note/);
    expect(out.body).not.toMatch(/Periodo/);
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
npm test -- src/lib/leaves/__tests__/audit.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 6.3: Create `src/lib/leaves/audit.ts`**

```ts
/**
 * Audit-trail helpers for leave edits.
 * `computeDiff` is pure; `formatDiffForNotification` produces email +
 * Telegram body snippets in Italian.
 */
import { formatItDate } from "./format";

const WATCHED_FIELDS = [
  "type",
  "startDate",
  "endDate",
  "hours",
  "timeSlots",
  "sickProtocol",
  "notes",
  "status",
] as const;

export type WatchedField = typeof WATCHED_FIELDS[number];

export interface LeaveSnapshot {
  type?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  hours?: number | null;
  timeSlots?: string | null;
  sickProtocol?: string | null;
  notes?: string | null;
  status?: string | null;
}

export interface LeaveDiff {
  changedFields: WatchedField[];
  changes: Partial<Record<WatchedField, { old: unknown; new: unknown }>>;
  oldSnapshot: LeaveSnapshot;
  newSnapshot: LeaveSnapshot;
}

function eq(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  return a === b;
}

export function computeDiff(prev: LeaveSnapshot, next: LeaveSnapshot): LeaveDiff {
  const changedFields: WatchedField[] = [];
  const changes: LeaveDiff["changes"] = {};
  for (const f of WATCHED_FIELDS) {
    if (!eq(prev[f], next[f])) {
      changedFields.push(f);
      changes[f] = { old: prev[f] ?? null, new: next[f] ?? null };
    }
  }
  return {
    changedFields,
    changes,
    oldSnapshot: pickWatched(prev),
    newSnapshot: pickWatched(next),
  };
}

function pickWatched(s: LeaveSnapshot): LeaveSnapshot {
  const out: LeaveSnapshot = {};
  for (const f of WATCHED_FIELDS) (out as Record<string, unknown>)[f] = s[f] ?? null;
  return out;
}

const FIELD_LABELS_IT: Record<WatchedField, string> = {
  type: "Tipo",
  startDate: "Inizio",
  endDate: "Fine",
  hours: "Ore",
  timeSlots: "Orari",
  sickProtocol: "Protocollo INPS",
  notes: "Note",
  status: "Stato",
};

function renderValue(field: WatchedField, value: unknown): string {
  if (value == null || value === "") return "—";
  if (field === "startDate" || field === "endDate") return formatItDate(String(value));
  if (field === "hours") return `${value}h`;
  if (field === "timeSlots") {
    try {
      const slots = JSON.parse(String(value)) as Array<{ from: string; to: string }>;
      return slots.map(s => `${s.from}-${s.to}`).join(", ");
    } catch { return String(value); }
  }
  return String(value);
}

export function formatDiffForNotification(
  diff: LeaveDiff,
  _locale: "it"
): { subject: string; body: string; telegramBody: string } {
  const lines: string[] = [];
  for (const f of diff.changedFields) {
    const change = diff.changes[f];
    if (!change) continue;
    lines.push(`- ${FIELD_LABELS_IT[f]}: ${renderValue(f, change.old)} → ${renderValue(f, change.new)}`);
  }
  const subject = "La tua richiesta è stata modificata";
  const body = lines.join("\n");
  const telegramBody = `✏️ Richiesta modificata:\n${lines.join("\n")}`;
  return { subject, body, telegramBody };
}
```

- [ ] **Step 6.4: Run audit tests**

```bash
npm test -- src/lib/leaves/__tests__/audit.test.ts
```

Expected: PASS.

- [ ] **Step 6.5: Write failing test for edit-service.ts**

Create `src/lib/leaves/__tests__/edit-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => {
  const db = {
    leaveRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    leaveRequestEdit: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { prisma: db };
});

import { editLeaveRequest } from "../edit-service";
import { prisma } from "../../db";

const mockPrisma = prisma as unknown as {
  leaveRequest: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  leaveRequestEdit: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const baseLeave = {
  id: "lr_1",
  employeeId: "emp_1",
  type: "VACATION",
  startDate: "2026-05-22",
  endDate: "2026-05-23",
  hours: null,
  timeSlots: null,
  sickProtocol: null,
  notes: null,
  status: "APPROVED",
  version: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("editLeaveRequest", () => {
  it("throws EDIT_NOT_ALLOWED_REJECTED for REJECTED leaves", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...baseLeave, status: "REJECTED" });
    await expect(editLeaveRequest("lr_1", "user_1", { version: 0, startDate: "2026-05-25" }))
      .rejects.toThrow("EDIT_NOT_ALLOWED_REJECTED");
  });

  it("throws STALE_STATE when version mismatch", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...baseLeave, version: 5 });
    await expect(editLeaveRequest("lr_1", "user_1", { version: 0, startDate: "2026-05-25" }))
      .rejects.toThrow("STALE_STATE");
  });

  it("returns idempotent result when no fields change", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(baseLeave);
    const r = await editLeaveRequest("lr_1", "user_1", { version: 0 });
    expect(r.changedFields).toEqual([]);
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.leaveRequestEdit.create).not.toHaveBeenCalled();
  });
});
```

**Note:** edit-service.test.ts is a minimal smoke test. Overlap re-check during edit is exercised in the integration smoke (Task 6.9). The Prisma mock is intentionally shallow — the test asserts control flow, not DB behavior.

- [ ] **Step 6.6: Run test to verify it fails**

```bash
npm test -- src/lib/leaves/__tests__/edit-service.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 6.7: Create `src/lib/leaves/edit-service.ts`**

```ts
/**
 * Orchestration for admin edits of APPROVED/PENDING leave requests.
 *
 * Transactional sequence: load → validate → merge → overlap re-check →
 * diff → update + version++ → audit insert. Notifications fire outside
 * the transaction (best-effort).
 */
import { prisma } from "../db";
import { checkOverlap } from "./overlap";
import { computeDiff } from "./audit";
import { type EditLeaveInput } from "./validation";

export class LeaveEditError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "LeaveEditError";
  }
}

export interface EditResult {
  leaveRequest: Awaited<ReturnType<typeof prisma.leaveRequest.findUnique>>;
  changedFields: string[];
  audit: Awaited<ReturnType<typeof prisma.leaveRequestEdit.create>> | null;
}

export async function editLeaveRequest(
  leaveId: string,
  editorUserId: string,
  input: EditLeaveInput
): Promise<EditResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!current) throw new LeaveEditError("NOT_FOUND", `Leave ${leaveId} not found`);

    if (current.status === "REJECTED") {
      throw new LeaveEditError("EDIT_NOT_ALLOWED_REJECTED", "Cannot edit a rejected request");
    }

    if (current.version !== input.version) {
      throw new LeaveEditError("STALE_STATE", `Version mismatch: expected ${current.version}, got ${input.version}`);
    }

    // Merge prev + delta.
    const next = {
      type: input.type ?? current.type,
      startDate: input.startDate ?? current.startDate,
      endDate: input.endDate ?? current.endDate,
      hours: input.hours !== undefined ? input.hours : current.hours,
      timeSlots: input.timeSlots !== undefined ? (input.timeSlots ? JSON.stringify(input.timeSlots) : null) : current.timeSlots,
      sickProtocol: input.sickProtocol !== undefined ? input.sickProtocol : current.sickProtocol,
      notes: input.notes !== undefined ? input.notes : current.notes,
      status: current.status, // edit endpoint does NOT change status
    };

    if (next.startDate > next.endDate) {
      throw new LeaveEditError("INVALID_RANGE", "startDate must be <= endDate after edit");
    }

    const diff = computeDiff(current, next);
    if (diff.changedFields.length === 0) {
      return { leaveRequest: current, changedFields: [], audit: null };
    }

    // Re-check overlap with the next state.
    const overlap = await checkOverlap(current.employeeId, {
      type: next.type,
      startDate: next.startDate,
      endDate: next.endDate,
      hours: next.hours,
      timeSlots: next.timeSlots,
    }, { excludeId: leaveId });

    if (overlap.kind === "BLOCK") {
      throw new LeaveEditError("OVERLAP_BLOCK", overlap.reason ?? "Overlap blocked");
    }
    if (overlap.kind === "REQUIRES_CONFIRM" && !input.confirmOverride) {
      throw new LeaveEditError("OVERLAP_REQUIRES_CONFIRM", "Confirmation required");
    }

    const updated = await tx.leaveRequest.update({
      where: { id: leaveId },
      data: {
        ...next,
        version: { increment: 1 },
      },
    });

    const audit = await tx.leaveRequestEdit.create({
      data: {
        leaveId,
        editedById: editorUserId,
        oldType: current.type, oldStartDate: current.startDate, oldEndDate: current.endDate,
        oldHours: current.hours, oldTimeSlots: current.timeSlots, oldSickProtocol: current.sickProtocol,
        oldNotes: current.notes, oldStatus: current.status,
        newType: next.type, newStartDate: next.startDate, newEndDate: next.endDate,
        newHours: next.hours, newTimeSlots: next.timeSlots, newSickProtocol: next.sickProtocol,
        newNotes: next.notes, newStatus: next.status,
        reason: input.reason ?? null,
        changedFields: JSON.stringify(diff.changedFields),
      },
    });

    return { leaveRequest: updated, changedFields: diff.changedFields, audit };
  });
}
```

- [ ] **Step 6.8: Run edit-service tests**

```bash
npm test -- src/lib/leaves/__tests__/edit-service.test.ts
```

Expected: PASS.

- [ ] **Step 6.9: Update `src/lib/leaves/index.ts`**

Append:

```ts
export * from "./audit";
export * from "./edit-service";
```

- [ ] **Step 6.10: Make PUT `/api/leaves/[id]` polymorphic**

Open `src/app/api/leaves/[id]/route.ts`. Add imports:

```ts
import { editLeaveSchema } from "@/lib/leaves/validation";
import { editLeaveRequest, LeaveEditError } from "@/lib/leaves/edit-service";
import { computeDiff, formatDiffForNotification } from "@/lib/leaves/audit";
```

Replace the PUT handler. The body branches: if `status` is in the body, run the existing approve/reject logic; otherwise run the edit branch.

Full replacement:

```ts
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const session = await auth();
  const { id } = await params;
  const body = await request.json();

  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave) {
    return NextResponse.json({ error: "Richiesta non trovata" }, { status: 404 });
  }

  // Branch A: status-only body → approve/reject (existing flow).
  if (typeof body.status === "string") {
    const { status, notes } = body as { status: string; notes?: string };

    const data: Record<string, unknown> = {};
    if (["APPROVED", "REJECTED"].includes(status)) {
      data.status = status;
      data.approvedAt = new Date();
      const sessionUserId = session?.user?.id;
      if (sessionUserId) {
        const existingUser = await prisma.user.findUnique({
          where: { id: sessionUserId },
          select: { id: true },
        });
        data.approvedById = existingUser ? sessionUserId : null;
      } else {
        data.approvedById = null;
      }
    }
    if (notes !== undefined) data.notes = notes;
    data.version = { increment: 1 };

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data,
      include: { employee: true, approvedBy: true },
    });

    if (status === "APPROVED" || status === "REJECTED") {
      try {
        await notifyLeaveDecision({
          employeeChatId: updated.employee.telegramChatId,
          status: status as "APPROVED" | "REJECTED",
          startDate: updated.startDate,
          endDate: updated.endDate,
          type: updated.type,
          notes: updated.notes,
        });
      } catch (err) {
        console.error("[leaves/PUT] notifyLeaveDecision failed:", err);
      }
      if (updated.employee.email) {
        try {
          const reply = leaveDecisionNotification({
            status: status as "APPROVED" | "REJECTED",
            startDate: updated.startDate,
            endDate: updated.endDate,
            employeeName: updated.employee.displayName || updated.employee.name,
            notes: updated.notes,
          });
          await sendMail({
            to: updated.employee.email,
            subject: reply.subject,
            text: reply.text,
            html: reply.html,
          });
        } catch (err) {
          console.error("[leaves/PUT] sendMail decision failed:", err);
        }
      }
      try {
        notificationsBus.publish({
          employeeId: updated.employeeId,
          employeeName: updated.employee.displayName || updated.employee.name,
          action: status === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
          time: LEAVE_TYPES[updated.type as LeaveType]?.label ?? updated.type,
          date: updated.startDate,
          details: {
            leaveId: updated.id,
            leaveType: updated.type,
            leaveStartDate: updated.startDate,
            leaveEndDate: updated.endDate,
          },
        });
      } catch (err) {
        console.error("[leaves/PUT] bus publish failed:", err);
      }
    }

    return NextResponse.json({
      id: updated.id,
      employeeId: updated.employeeId,
      employeeName: updated.employee.displayName || updated.employee.name,
      type: updated.type,
      typeLabel: LEAVE_TYPES[updated.type as LeaveType]?.label ?? updated.type,
      startDate: updated.startDate,
      endDate: updated.endDate,
      hours: updated.hours,
      status: updated.status,
      source: updated.source,
      approvedBy: updated.approvedBy?.name ?? null,
      approvedAt: updated.approvedAt?.toISOString() ?? null,
      version: updated.version,
    });
  }

  // Branch B: edit (everything else). Admin only enforced by checkAuth above.
  const parsed = editLeaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const editorUserId = session?.user?.id;
  if (!editorUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await editLeaveRequest(id, editorUserId, parsed.data);

    // Notification is deferred to Task 7 — for now, just bus-publish.
    if (result.changedFields.length > 0 && result.leaveRequest) {
      try {
        notificationsBus.publish({
          employeeId: result.leaveRequest.employeeId,
          employeeName: "", // populated in Task 7 notification work
          action: "LEAVE_EDITED",
          time: LEAVE_TYPES[result.leaveRequest.type as LeaveType]?.label ?? result.leaveRequest.type,
          date: result.leaveRequest.startDate,
          details: {
            leaveId: result.leaveRequest.id,
            leaveType: result.leaveRequest.type,
            leaveStartDate: result.leaveRequest.startDate,
            leaveEndDate: result.leaveRequest.endDate,
            changedFields: result.changedFields,
          },
        });
      } catch (err) {
        console.error("[leaves/PUT] bus publish edit failed:", err);
      }
    }

    return NextResponse.json({
      id: result.leaveRequest?.id,
      changedFields: result.changedFields,
      version: result.leaveRequest?.version,
    });
  } catch (err) {
    if (err instanceof LeaveEditError) {
      const statusMap: Record<string, number> = {
        EDIT_NOT_ALLOWED_REJECTED: 403,
        STALE_STATE: 409,
        OVERLAP_BLOCK: 409,
        OVERLAP_REQUIRES_CONFIRM: 409,
        INVALID_RANGE: 400,
        NOT_FOUND: 404,
      };
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: statusMap[err.code] ?? 500 }
      );
    }
    console.error("[leaves/PUT] edit error:", err);
    return NextResponse.json({ error: "Errore interno" }, { status: 500 });
  }
}
```

**Note:** the `LEAVE_EDITED` bus action may not exist yet in `notifications-bus.ts`. If TypeScript complains, add it as a union member in that file (small one-line change). Inspect `src/lib/notifications-bus.ts` first.

- [ ] **Step 6.10b: Expose `version` in GET `/api/leaves` list and GET `/api/leaves/[id]` detail**

`EditLeaveModal` (Task 9) needs the current `version` to send in the edit payload. Add it to both response shapes.

In `src/app/api/leaves/route.ts` GET handler, in the `result.map(...)` block (around lines 44-61), add to each mapped object:

```ts
      version: l.version,
```

In `src/app/api/leaves/[id]/route.ts` GET handler (around lines 28-45), add to the returned object:

```ts
    version: leave.version,
```

Also include it in the response of POST `/api/leaves` (Task 5.6 response object) so the client has the version right after creation:

```ts
      version: leave.version,
```

- [ ] **Step 6.11: Create `src/app/api/leaves/[id]/edits/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const edits = await prisma.leaveRequestEdit.findMany({
    where: { leaveId: id },
    orderBy: { editedAt: "desc" },
    include: { editedBy: { select: { id: true, name: true } } },
  });

  return NextResponse.json(edits.map(e => ({
    id: e.id,
    editedAt: e.editedAt.toISOString(),
    editedBy: e.editedBy?.name ?? null,
    changedFields: JSON.parse(e.changedFields) as string[],
    reason: e.reason,
    oldSnapshot: {
      type: e.oldType, startDate: e.oldStartDate, endDate: e.oldEndDate,
      hours: e.oldHours, timeSlots: e.oldTimeSlots, sickProtocol: e.oldSickProtocol,
      notes: e.oldNotes, status: e.oldStatus,
    },
    newSnapshot: {
      type: e.newType, startDate: e.newStartDate, endDate: e.newEndDate,
      hours: e.newHours, timeSlots: e.newTimeSlots, sickProtocol: e.newSickProtocol,
      notes: e.newNotes, status: e.newStatus,
    },
  })));
}
```

- [ ] **Step 6.12: Type-check + tests**

```bash
npx tsc --noEmit
npm test
```

Expected: green.

- [ ] **Step 6.13: Manual smoke**

```bash
npm run dev
```

In browser as admin: edit an APPROVED leave by sending PUT body `{ version: 0, startDate: "...", endDate: "..." }`. Verify 200 response and that a row appears in `LeaveRequestEdit`:

```bash
npx prisma studio
```

In Prisma Studio, open `LeaveRequestEdit` table. Confirm the row.

- [ ] **Step 6.14: Commit**

```bash
git add src/lib/leaves/audit.ts src/lib/leaves/edit-service.ts src/lib/leaves/__tests__/audit.test.ts src/lib/leaves/__tests__/edit-service.test.ts src/lib/leaves/index.ts src/app/api/leaves/[id]/route.ts src/app/api/leaves/[id]/edits/route.ts src/lib/notifications-bus.ts
git commit -m "$(cat <<'EOF'
feat(leaves): admin edit with audit trail

- src/lib/leaves/audit.ts: computeDiff + formatDiffForNotification
- src/lib/leaves/edit-service.ts: transactional edit (load → validate
  → overlap re-check → diff → update + version++ → audit insert)
- PUT /api/leaves/:id polymorphic — status-only branch unchanged,
  edit branch (other fields) routes to edit-service
- GET /api/leaves/:id/edits — audit history endpoint

Resolves user appunto #2 + audit H1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Edit notifications (email + Telegram + WS event)

**Files:**
- Modify: `src/lib/leave-notifications.ts` (+ `notifyLeaveEdited`)
- Modify: `src/lib/mail-templates.ts` (+ `leaveEditedNotification`)
- Modify: `src/lib/telegram-handlers.ts` (if it exports `notifyLeaveEdited` analog for Telegram, otherwise add small helper)
- Modify: `src/app/api/leaves/[id]/route.ts` (wire `notifyLeaveEdited` after edit success)

- [ ] **Step 7.1: Add `leaveEditedNotification` mail template**

Open `src/lib/mail-templates.ts`. Append:

```ts
import { formatItDate } from "./leaves/format";

export interface LeaveEditedNotificationArgs {
  employeeName: string;
  adminName: string;
  createdAt: string; // ISO
  diffBody: string;  // pre-rendered "- Field: old → new" lines
  reason?: string | null;
  status: string;
}

export function leaveEditedNotification(args: LeaveEditedNotificationArgs) {
  const createdAtIt = formatItDate(args.createdAt.slice(0, 10));
  const subject = `La tua richiesta è stata modificata`;
  const text = `Ciao ${args.employeeName},
l'admin ${args.adminName} ha modificato la tua richiesta inviata il ${createdAtIt}.

Modifiche:
${args.diffBody}

Motivo: ${args.reason ?? "non specificato"}

Stato attuale: ${args.status}.
`;
  const html = `<p>Ciao ${args.employeeName},</p>
<p>l'admin <strong>${args.adminName}</strong> ha modificato la tua richiesta inviata il ${createdAtIt}.</p>
<p><strong>Modifiche:</strong></p>
<pre>${args.diffBody.replace(/</g, "&lt;")}</pre>
<p><strong>Motivo:</strong> ${args.reason ?? "non specificato"}</p>
<p>Stato attuale: <strong>${args.status}</strong>.</p>`;
  return { subject, text, html };
}
```

- [ ] **Step 7.2: Add `notifyLeaveEdited` to `leave-notifications.ts`**

Open `src/lib/leave-notifications.ts`. Inspect the file to see how `notifyAdminsOfPendingLeave` is structured, then append a sibling function:

```ts
import { leaveEditedNotification } from "./mail-templates";
import { sendMail } from "./mail-send";
// telegram side: reuse existing telegram bot send helper. Adjust import
// to match what already exists in this file (notifyLeaveDecision lives
// in telegram-handlers.ts, so we reuse that channel).
import { sendTelegramMessage } from "./telegram-bot"; // adjust to actual path used elsewhere

export interface NotifyLeaveEditedArgs {
  employeeEmail: string | null;
  employeeName: string;
  employeeChatId: string | null;
  adminName: string;
  createdAt: string;
  diffBody: string;
  telegramBody: string;
  reason?: string | null;
  status: string;
}

export async function notifyLeaveEdited(args: NotifyLeaveEditedArgs): Promise<void> {
  // Email
  if (args.employeeEmail) {
    try {
      const reply = leaveEditedNotification({
        employeeName: args.employeeName,
        adminName: args.adminName,
        createdAt: args.createdAt,
        diffBody: args.diffBody,
        reason: args.reason,
        status: args.status,
      });
      await sendMail({
        to: args.employeeEmail,
        subject: reply.subject,
        text: reply.text,
        html: reply.html,
      });
    } catch (err) {
      console.error("[notifyLeaveEdited] email failed:", err);
    }
  }

  // Telegram
  if (args.employeeChatId) {
    try {
      await sendTelegramMessage(args.employeeChatId, args.telegramBody);
    } catch (err) {
      console.error("[notifyLeaveEdited] telegram failed:", err);
    }
  }
}
```

**Verify imports:** before saving, run:

```bash
grep -rn "sendTelegramMessage\|sendTelegramText" src/lib --include="*.ts" | head
```

Use the actual function name found. If the project sends Telegram messages directly via `fetch` inside `telegram-handlers.ts`, extract a small helper or replicate the fetch call inline.

- [ ] **Step 7.3: Wire `notifyLeaveEdited` in PUT `/api/leaves/[id]` edit branch**

In `src/app/api/leaves/[id]/route.ts`, inside the edit branch (Task 6.10), after `editLeaveRequest` succeeds and `result.changedFields.length > 0`, before the bus publish, add:

```ts
// Load employee + editor names for notification (the update doesn't include relations).
const fullLeave = await prisma.leaveRequest.findUnique({
  where: { id: result.leaveRequest!.id },
  include: { employee: true },
});
const editor = await prisma.user.findUnique({ where: { id: editorUserId }, select: { name: true } });

if (fullLeave) {
  const prevSnapshot = {
    type: result.audit?.oldType ?? null,
    startDate: result.audit?.oldStartDate ?? null,
    endDate: result.audit?.oldEndDate ?? null,
    hours: result.audit?.oldHours ?? null,
    timeSlots: result.audit?.oldTimeSlots ?? null,
    sickProtocol: result.audit?.oldSickProtocol ?? null,
    notes: result.audit?.oldNotes ?? null,
    status: result.audit?.oldStatus ?? null,
  };
  const nextSnapshot = {
    type: fullLeave.type,
    startDate: fullLeave.startDate,
    endDate: fullLeave.endDate,
    hours: fullLeave.hours,
    timeSlots: fullLeave.timeSlots,
    sickProtocol: fullLeave.sickProtocol,
    notes: fullLeave.notes,
    status: fullLeave.status,
  };
  const diff = computeDiff(prevSnapshot, nextSnapshot);
  const formatted = formatDiffForNotification(diff, "it");

  void notifyLeaveEdited({
    employeeEmail: fullLeave.employee.email,
    employeeName: fullLeave.employee.displayName || fullLeave.employee.name,
    employeeChatId: fullLeave.employee.telegramChatId,
    adminName: editor?.name ?? "Admin",
    createdAt: fullLeave.createdAt.toISOString(),
    diffBody: formatted.body,
    telegramBody: formatted.telegramBody,
    reason: parsed.data.reason ?? null,
    status: fullLeave.status,
  });
}
```

Add import at top of file:

```ts
import { notifyLeaveEdited } from "@/lib/leave-notifications";
```

- [ ] **Step 7.4: Type-check + tests**

```bash
npx tsc --noEmit
npm test
```

Expected: green.

- [ ] **Step 7.5: Manual smoke — verify email + Telegram fire**

```bash
npm run dev
```

Edit an approved leave via PUT. Watch console for `[notifyLeaveEdited]` errors. Inspect logs for the outgoing email (`sendMail` likely logs success). If the employee has a `telegramChatId`, the bot will post the diff in the chat.

- [ ] **Step 7.6: Commit**

```bash
git add src/lib/leave-notifications.ts src/lib/mail-templates.ts src/app/api/leaves/[id]/route.ts
git commit -m "$(cat <<'EOF'
feat(leaves): notify employee on admin edit

- mail-templates.ts: leaveEditedNotification template (subject/text/html)
- leave-notifications.ts: notifyLeaveEdited fires email + Telegram
- PUT /api/leaves/:id edit branch wires the call after successful edit

Notifications run outside the edit transaction (best-effort).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Preview-days endpoint + CreateLeaveModal integration

**Files:**
- Create: `src/app/api/leaves/preview-days/route.ts`
- Modify: `src/app/(dashboard)/leaves/_components/CreateLeaveModal.tsx`

- [ ] **Step 8.1: Create the preview-days API**

```ts
// src/app/api/leaves/preview-days/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuthAny, isAuthUser, resolveEmployeeId } from "@/lib/auth-guard";
import { countWorkDays, expandToWorkingDays } from "@/lib/leaves/working-days";
import { isPublicHoliday } from "@/lib/leaves/holidays";

export async function POST(request: NextRequest) {
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;

  const body = await request.json();
  let { employeeId } = body as { employeeId?: string };
  const { startDate, endDate, type } = body as {
    startDate?: string; endDate?: string; type?: string;
  };

  if (authResult.role === "EMPLOYEE") {
    employeeId = (await resolveEmployeeId(authResult)) ?? undefined;
  }

  if (!employeeId || !startDate || !endDate || !type) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  // Pull employee schedule.
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { schedule: true },
  });
  if (!employee) return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });

  const scheduleMap = new Map<number, unknown>();
  for (const s of employee.schedule) scheduleMap.set(s.dayOfWeek, s);

  // Half-days and hourly types do not benefit from working-days expansion.
  if (type === "VACATION_HALF_AM" || type === "VACATION_HALF_PM") {
    return NextResponse.json({
      effectiveDays: 0.5,
      breakdown: [{ date: startDate, working: true }],
    });
  }
  if (["ROL", "BEREAVEMENT", "MARRIAGE", "LAW_104", "MEDICAL_VISIT"].includes(type)) {
    return NextResponse.json({
      effectiveDays: null, // computed from hours, not days
      hoursMode: true,
    });
  }

  const workingDays = expandToWorkingDays(startDate, endDate, scheduleMap);
  const effectiveDays = workingDays.length;

  // Build breakdown for UI.
  const breakdown: Array<{ date: string; working: boolean; reason?: string }> = [];
  let cur = startDate;
  while (cur <= endDate) {
    const [y, m, d] = cur.split("-").map(Number);
    const dowMap: Record<number, string> = { 0: "Domenica", 1: "Lunedì", 2: "Martedì", 3: "Mercoledì", 4: "Giovedì", 5: "Venerdì", 6: "Sabato" };
    const jsDow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
    const dowIso = jsDow === 0 ? 7 : jsDow;
    let reason: string | undefined;
    let working = scheduleMap.has(dowIso);
    if (working && isPublicHoliday(cur)) {
      working = false;
      reason = "Festività";
    } else if (!working) {
      reason = dowMap[jsDow];
    }
    breakdown.push({ date: cur, working, reason });

    // Increment cur by one day (string-safe).
    const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    t.setUTCDate(t.getUTCDate() + 1);
    cur = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  }

  return NextResponse.json({ effectiveDays, breakdown });
}
```

- [ ] **Step 8.2: Integrate preview block into CreateLeaveModal**

Open `src/app/(dashboard)/leaves/_components/CreateLeaveModal.tsx`. Identify the section where `startDate`, `endDate`, and `type` state are managed. Below the date pickers and above the submit button, add a `useEffect` that debounces a fetch to `/api/leaves/preview-days` and displays the result.

Pseudo-patch (paste full block where date pickers end):

```tsx
const [preview, setPreview] = useState<null | {
  effectiveDays: number | null;
  breakdown?: Array<{ date: string; working: boolean; reason?: string }>;
  hoursMode?: boolean;
}>(null);

useEffect(() => {
  if (!employeeId || !startDate || !endDate || !type) { setPreview(null); return; }
  if (startDate > endDate) { setPreview(null); return; }

  const handle = setTimeout(async () => {
    try {
      const res = await fetch("/api/leaves/preview-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, startDate, endDate, type }),
      });
      if (!res.ok) { setPreview(null); return; }
      const data = await res.json();
      setPreview(data);
    } catch {
      setPreview(null);
    }
  }, 300);
  return () => clearTimeout(handle);
}, [employeeId, startDate, endDate, type]);
```

Render block right below the date pickers (before the submit button):

```tsx
{preview && preview.effectiveDays !== null && !preview.hoursMode && (
  <div className="mt-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
    <strong>Userai {preview.effectiveDays} giorni lavorativi.</strong>
    {preview.breakdown && preview.breakdown.filter(b => !b.working).length > 0 && (
      <div className="mt-1 text-xs text-gray-600">
        Giorni non lavorativi esclusi:{" "}
        {preview.breakdown
          .filter(b => !b.working)
          .map(b => `${formatItDate(b.date)} (${b.reason ?? ""})`)
          .join(", ")}
      </div>
    )}
  </div>
)}
```

Add import at top:

```tsx
import { formatItDate } from "@/lib/leaves/format";
```

**Error handling on submit:** in the submit handler, when `fetch("/api/leaves", { method: "POST" })` returns 409, branch on `error`:

```tsx
if (!res.ok) {
  const errBody = await res.json();
  if (errBody.error === "OVERLAP_BLOCK") {
    toast.error(`Conflitto: ${errBody.reason ?? "richiesta sovrapposta"}`);
    return;
  }
  if (errBody.error === "OVERLAP_REQUIRES_CONFIRM") {
    const proceed = await confirm({
      title: "Conflitto rilevato",
      description: `Esiste già una richiesta in conflitto. Procedere comunque?`,
      confirmText: "Conferma e crea",
    });
    if (!proceed) return;
    // Retry with confirmOverride
    const retry = await fetch("/api/leaves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, confirmOverride: true }),
    });
    if (!retry.ok) { toast.error("Impossibile creare la richiesta"); return; }
    // ... success path
    return;
  }
  toast.error(errBody.error ?? "Errore creazione richiesta");
  return;
}
```

`confirm` is the existing `useConfirm` hook from `ConfirmProvider`. Verify usage by grepping:

```bash
grep -n "useConfirm" src/app/\(dashboard\)/leaves --include="*.tsx" -r
```

If `useConfirm` exists in scope (likely via context), use it as shown. Otherwise call `window.confirm(...)` as a fallback (note in commit msg).

- [ ] **Step 8.3: Manual UI smoke**

```bash
npm run dev
```

In browser, open the leaves page, click "Nuova richiesta". Select dates spanning a weekend or a holiday. Verify the preview line shows the correct effective day count + excluded days.

Submit a request that overlaps an existing one. Verify the toast/confirm dialog appears for BLOCK / REQUIRES_CONFIRM.

- [ ] **Step 8.4: Commit**

```bash
git add src/app/api/leaves/preview-days/route.ts src/app/\(dashboard\)/leaves/_components/CreateLeaveModal.tsx
git commit -m "$(cat <<'EOF'
feat(leaves): working-days preview in create modal

- POST /api/leaves/preview-days returns effective working-day count
  + per-day breakdown (excluded reason: weekend / holiday name)
- CreateLeaveModal renders the preview reactively (300ms debounce)
- Submit handler branches on 409 OVERLAP_BLOCK / REQUIRES_CONFIRM with
  confirm dialog + retry+confirmOverride

Closes the UX gap that caused users to perceive Fri-Mon as 4 days.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: EditLeaveModal + RequestsList edit button + page.tsx wiring

**Files:**
- Create: `src/app/(dashboard)/leaves/_components/EditLeaveModal.tsx`
- Optional create: `src/app/(dashboard)/leaves/_components/LeaveFormFields.tsx` (extracted shared fields)
- Modify: `src/app/(dashboard)/leaves/_components/RequestsList.tsx`
- Modify: `src/app/(dashboard)/leaves/page.tsx`

- [ ] **Step 9.1: Extract `LeaveFormFields.tsx` (optional but recommended)**

Inspect `CreateLeaveModal.tsx`. Move the form-fields JSX (type select, date pickers, hours, timeSlots, notes, sickProtocol) into a new file `LeaveFormFields.tsx` that accepts controlled-component props:

```tsx
// src/app/(dashboard)/leaves/_components/LeaveFormFields.tsx
"use client";
import type { ChangeEvent } from "react";

export interface LeaveFormState {
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: Array<{ from: string; to: string }>;
  sickProtocol: string;
  notes: string;
}

export interface LeaveFormFieldsProps {
  value: LeaveFormState;
  onChange: (next: LeaveFormState) => void;
  disabledTypes?: string[];
}

export function LeaveFormFields({ value, onChange, disabledTypes }: LeaveFormFieldsProps) {
  // Render the type <select>, date pickers, conditional hours/timeSlots, notes textarea.
  // Refactor the existing JSX from CreateLeaveModal into here verbatim, wiring each
  // field's onChange to `onChange({ ...value, fieldName: e.target.value })`.
  // (Exact JSX omitted here — copy from CreateLeaveModal.tsx as-is, just replacing
  // local useState with props.)
  return /* JSX */ null;
}
```

Then update `CreateLeaveModal.tsx` to use `<LeaveFormFields>` internally. Keep the rest of CreateLeaveModal (preview block, submit logic) outside the extracted component.

**If the time cost of extracting fields is high**, skip Step 9.1 and duplicate the fields in `EditLeaveModal.tsx`. Note the duplication in the commit message — to be deduped in a future cleanup.

- [ ] **Step 9.2: Create `EditLeaveModal.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { LeaveFormFields, type LeaveFormState } from "./LeaveFormFields";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useConfirm } from "@/components/ConfirmProvider";
import { toast } from "sonner";
import { formatItDate } from "@/lib/leaves/format";

interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: Array<{ from: string; to: string }> | null;
  sickProtocol: string | null;
  notes: string | null;
  status: string;
  version: number;
}

interface EditEntry {
  id: string;
  editedAt: string;
  editedBy: string | null;
  changedFields: string[];
  reason: string | null;
}

export interface EditLeaveModalProps {
  request: LeaveRequest;
  onClose: () => void;
  onSaved: () => void;
}

export function EditLeaveModal({ request, onClose, onSaved }: EditLeaveModalProps) {
  const { modalRef } = useModalA11y(true, onClose);
  const confirm = useConfirm();

  const [form, setForm] = useState<LeaveFormState>({
    type: request.type,
    startDate: request.startDate,
    endDate: request.endDate,
    hours: request.hours,
    timeSlots: request.timeSlots ?? [],
    sickProtocol: request.sickProtocol ?? "",
    notes: request.notes ?? "",
  });
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<EditEntry[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Lazy load history on expand.
  useEffect(() => {
    if (!historyOpen || history !== null) return;
    fetch(`/api/leaves/${request.id}/edits`)
      .then(r => r.json())
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [historyOpen, history, request.id]);

  const isDirty =
    form.type !== request.type ||
    form.startDate !== request.startDate ||
    form.endDate !== request.endDate ||
    form.hours !== request.hours ||
    form.notes !== (request.notes ?? "") ||
    JSON.stringify(form.timeSlots) !== JSON.stringify(request.timeSlots ?? []) ||
    form.sickProtocol !== (request.sickProtocol ?? "") ||
    reason !== "";

  async function handleClose() {
    if (isDirty) {
      const ok = await confirm({
        title: "Annullare le modifiche?",
        description: "Le modifiche non salvate andranno perse.",
        confirmText: "Sì, annulla",
      });
      if (!ok) return;
    }
    onClose();
  }

  async function handleSubmit(confirmOverride = false) {
    setSubmitting(true);
    try {
      const payload = {
        version: request.version,
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate,
        hours: form.hours,
        timeSlots: form.timeSlots.length > 0 ? form.timeSlots : null,
        sickProtocol: form.sickProtocol || null,
        notes: form.notes || null,
        reason: reason || undefined,
        confirmOverride: confirmOverride || undefined,
      };
      const res = await fetch(`/api/leaves/${request.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error === "OVERLAP_REQUIRES_CONFIRM") {
          const proceed = await confirm({
            title: "Conflitto rilevato",
            description: "Esiste una richiesta in conflitto. Procedere comunque?",
            confirmText: "Conferma",
          });
          if (proceed) await handleSubmit(true);
          return;
        }
        if (err.error === "STALE_STATE") {
          toast.error("La richiesta è stata modificata da qualcun altro. Ricarica la pagina.");
          return;
        }
        if (err.error === "OVERLAP_BLOCK") {
          toast.error(`Conflitto: ${err.message ?? "richiesta sovrapposta"}`);
          return;
        }
        if (err.error === "EDIT_NOT_ALLOWED_REJECTED") {
          toast.error("Non si possono modificare richieste rifiutate");
          return;
        }
        toast.error(err.error ?? "Errore");
        return;
      }
      toast.success("Richiesta modificata");
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div ref={modalRef} className="w-full max-w-xl rounded bg-white p-6 shadow-lg" role="dialog" aria-modal="true">
        <h2 className="mb-4 text-lg font-semibold">
          Modifica richiesta di {request.employeeName}
        </h2>

        <LeaveFormFields value={form} onChange={setForm} />

        <label className="mt-4 block text-sm">
          Motivo modifica (interno, opzionale)
          <textarea
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            maxLength={500}
          />
        </label>

        <details className="mt-4" open={historyOpen} onToggle={e => setHistoryOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-sm font-medium">Storia modifiche</summary>
          {history === null && historyOpen && <div className="mt-2 text-sm text-gray-500">Caricamento…</div>}
          {history && history.length === 0 && <div className="mt-2 text-sm text-gray-500">Nessuna modifica.</div>}
          {history && history.length > 0 && (
            <ul className="mt-2 space-y-2 text-sm">
              {history.map(h => (
                <li key={h.id} className="border-l-2 border-gray-300 pl-3">
                  <div className="text-xs text-gray-500">
                    {formatItDate(h.editedAt.slice(0, 10))} — {h.editedBy ?? "Sistema"}
                  </div>
                  <div>Campi: {h.changedFields.join(", ")}</div>
                  {h.reason && <div className="text-xs text-gray-600">{h.reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </details>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={handleClose} className="rounded border border-gray-300 px-3 py-1.5">
            Annulla
          </button>
          <button
            onClick={() => handleSubmit(false)}
            disabled={!isDirty || submitting}
            className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50"
          >
            Salva modifiche
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Verify imports** — adjust paths to actual files in the project. Common adjustments:
- `useModalA11y` may live at `@/components/useModalA11y` or `@/hooks/useModalA11y` — grep first.
- `useConfirm` exact import location — grep for it.

```bash
grep -rn "export.*useModalA11y\|export.*useConfirm" src --include="*.ts" --include="*.tsx"
```

- [ ] **Step 9.3: Add edit button in `RequestsList.tsx`**

Inspect the current row-action block (around lines 88-106 per audit). Add a "Modifica" button next to Approve/Reject/Delete, visible when `status ∈ {APPROVED, PENDING}`.

Patch fragment:

```tsx
{(request.status === "APPROVED" || request.status === "PENDING") && (
  <button
    onClick={() => onEdit(request)}
    className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
    title="Modifica richiesta"
  >
    Modifica
  </button>
)}
```

Add `onEdit: (r: LeaveRequest) => void` to the `RequestsListProps` interface.

- [ ] **Step 9.4: Wire state in `page.tsx`**

In `src/app/(dashboard)/leaves/page.tsx`, add state + handler + mount:

```tsx
const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(null);

function handleEditRequest(r: LeaveRequest) {
  setEditingRequest(r);
}

// Pass onEdit={handleEditRequest} to <RequestsList />.

// Mount near the end:
{editingRequest && (
  <EditLeaveModal
    request={editingRequest}
    onClose={() => setEditingRequest(null)}
    onSaved={() => { /* trigger refresh of the list, same as CreateLeaveModal onSaved */ }}
  />
)}
```

Add imports:

```tsx
import { EditLeaveModal } from "./_components/EditLeaveModal";
```

The `LeaveRequest` type is local to the page — make sure it has `version: number` field; if not, add it (the GET endpoint returns it after Task 1+6).

- [ ] **Step 9.5: Manual UI smoke**

```bash
npm run dev
```

In browser:
- Click "Modifica" on an APPROVED leave → modal opens with prefilled fields.
- Change `endDate`, add a reason, click Salva.
- Verify toast success, the row in the list updates with the new dates.
- Re-open the modal → "Storia modifiche" accordion shows the previous edit.
- Try to edit with same field value (no-op) → no toast (silently OK) or success without history entry.
- Try editing a REJECTED row (button shouldn't appear).

- [ ] **Step 9.6: Commit**

```bash
git add "src/app/(dashboard)/leaves/_components/EditLeaveModal.tsx" "src/app/(dashboard)/leaves/_components/LeaveFormFields.tsx" "src/app/(dashboard)/leaves/_components/RequestsList.tsx" "src/app/(dashboard)/leaves/_components/CreateLeaveModal.tsx" "src/app/(dashboard)/leaves/page.tsx"
git commit -m "$(cat <<'EOF'
feat(leaves): admin edit modal with history

- EditLeaveModal: prefilled form for APPROVED/PENDING request edits
- LeaveFormFields: shared between Create + Edit modals
- RequestsList: edit button visible only for APPROVED/PENDING rows
- page.tsx: editing state + modal mount + refresh-on-save

Modal surfaces audit history via collapsible "Storia modifiche" that
lazy-fetches /api/leaves/:id/edits on first open. Handles 409
OVERLAP_BLOCK / REQUIRES_CONFIRM with confirm dialog + retry.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Email ingest — type detection + past-date + overlap

**Files:**
- Modify: `src/lib/mail-ingest.ts`
- Modify: `src/lib/mail-templates.ts` (+ 3 reply templates)

- [ ] **Step 10.1: Add 3 reply templates in `mail-templates.ts`**

Append to `src/lib/mail-templates.ts`:

```ts
export function replyTypeUnknown(): { subject: string; text: string; html: string } {
  const subject = "Richiesta non riconosciuta";
  const text = `La tua richiesta non ha un tipo riconoscibile.
L'oggetto deve contenere una di queste parole: ferie, ROL, permesso, malattia, lutto, matrimonio, visita medica, 104.`;
  const html = `<p>La tua richiesta non ha un tipo riconoscibile.</p>
<p>L'oggetto deve contenere una di queste parole: <strong>ferie, ROL, permesso, malattia, lutto, matrimonio, visita medica, 104</strong>.</p>`;
  return { subject, text, html };
}

export function replyPastDate(detail: string): { subject: string; text: string; html: string } {
  const subject = "Data nel passato";
  const text = `La data indicata è nel passato e non può essere accettata automaticamente.
${detail}
Se intendi richiedere per l'anno successivo, includi l'anno nel formato gg/mm/aaaa.`;
  const html = `<p>La data indicata è nel passato e non può essere accettata automaticamente.</p>
<p>${detail}</p>
<p>Se intendi richiedere per l'anno successivo, includi l'anno nel formato <code>gg/mm/aaaa</code>.</p>`;
  return { subject, text, html };
}

export function replyOverlap(conflicts: Array<{ type: string; startDate: string; endDate: string }>): { subject: string; text: string; html: string } {
  const list = conflicts.map(c => `- ${c.type} dal ${c.startDate} al ${c.endDate}`).join("\n");
  const subject = "Richiesta in conflitto con un'altra esistente";
  const text = `La richiesta è in conflitto con una richiesta esistente:
${list}
Contatta l'amministratore per gestire il conflitto.`;
  const html = `<p>La richiesta è in conflitto con una richiesta esistente:</p>
<pre>${list}</pre>
<p>Contatta l'amministratore per gestire il conflitto.</p>`;
  return { subject, text, html };
}
```

- [ ] **Step 10.2: Refactor `mail-ingest.ts`**

Open `src/lib/mail-ingest.ts`. Replace the hardcoded `type = "VACATION"` and the bare `parseLeaveDates(body)` call with the new flow:

```ts
import { detectLeaveTypeFromSubject, parseLeaveDates } from "./leaves/validation";
import { checkOverlap } from "./leaves/overlap";
import { replyTypeUnknown, replyPastDate, replyOverlap } from "./mail-templates";
import { todayRome } from "./tz";

// Inside the per-message handler (around the current "type = VACATION" / parseLeaveDates block):
const type = detectLeaveTypeFromSubject(mail.subject);
if (!type) {
  const tpl = replyTypeUnknown();
  await sendMail({ to: mail.from, subject: tpl.subject, text: tpl.text, html: tpl.html });
  await logIngest({ messageId: mail.messageId, fromAddress: mail.from, subject: mail.subject, status: "TYPE_UNKNOWN" });
  continue;
}

const parsed = parseLeaveDates(mail.body, todayRome());
if (!parsed.ok) {
  if (parsed.reason === "PAST_DATE") {
    const tpl = replyPastDate(parsed.detail ?? "");
    await sendMail({ to: mail.from, subject: tpl.subject, text: tpl.text, html: tpl.html });
    await logIngest({ messageId: mail.messageId, fromAddress: mail.from, subject: mail.subject, status: "PAST_DATE", errorDetail: parsed.detail });
  } else {
    // existing parse-error reply path
    await replyParseError(mail, parsed.reason);
    await logIngest({ messageId: mail.messageId, fromAddress: mail.from, subject: mail.subject, status: "PARSE_ERROR" });
  }
  continue;
}

const overlap = await checkOverlap(employee.id, {
  type, startDate: parsed.startDate, endDate: parsed.endDate,
});
if (overlap.kind !== "OK") {
  const tpl = replyOverlap(overlap.conflicts.map(c => ({ type: c.type, startDate: c.startDate, endDate: c.endDate })));
  await sendMail({ to: mail.from, subject: tpl.subject, text: tpl.text, html: tpl.html });
  await logIngest({ messageId: mail.messageId, fromAddress: mail.from, subject: mail.subject, status: "OVERLAP_BLOCK" });
  continue;
}

await prisma.leaveRequest.create({
  data: {
    employeeId: employee.id,
    type,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    status: "PENDING",
    source: "EXTERNAL_API",
  },
});
```

**Exact placement:** read the current `mail-ingest.ts` end-to-end first — the loop structure may differ. Insert these blocks in the spot where the message is being processed and the current hardcoded `type = "VACATION"` lives.

```bash
cat src/lib/mail-ingest.ts | head -300
```

- [ ] **Step 10.3: Type-check + tests**

```bash
npx tsc --noEmit
npm test
```

Expected: green. Existing `parseLeaveDates` shim usage is unaffected (back-compat). New mail-ingest flow compiles.

- [ ] **Step 10.4: Manual smoke**

If a Microsoft Graph dev account is configured:
- Send an email to the ingest mailbox with subject "rol del 22/05" → expect a ROL PENDING request, NOT VACATION.
- Send with subject "ferie dal 15/04 al 18/04" while today is December → expect a PAST_DATE reply.
- Send a duplicate ferie request overlapping an existing PENDING → expect overlap reply, no new request.

If no dev mail account, this is a code-only commit — the manual smoke is delivered when prod runs.

- [ ] **Step 10.5: Commit**

```bash
git add src/lib/mail-ingest.ts src/lib/mail-templates.ts
git commit -m "$(cat <<'EOF'
feat(mail-ingest): detect leave type from subject

- detectLeaveTypeFromSubject replaces hardcoded "VACATION"
- parseLeaveDates(body, todayRome()) rejects PAST_DATE explicitly
- checkOverlap runs before creating the LeaveRequest
- 3 new reply templates: replyTypeUnknown / replyPastDate / replyOverlap
- EmailIngestLog status gains TYPE_UNKNOWN, PAST_DATE, OVERLAP_BLOCK

Resolves audit M6 (hardcoded VACATION) and M7 (past-date silent
acceptance) for the email path.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After all 10 commits land:

- [ ] **Run the full test suite:**

```bash
npm test
```

Expected: all green. New tests:
- `src/lib/leaves/__tests__/holidays.test.ts`
- `src/lib/leaves/__tests__/working-days.test.ts`
- `src/lib/leaves/__tests__/validation.test.ts`
- `src/lib/leaves/__tests__/overlap.test.ts`
- `src/lib/leaves/__tests__/audit.test.ts`
- `src/lib/leaves/__tests__/edit-service.test.ts`

- [ ] **Type-check:**

```bash
npx tsc --noEmit
```

- [ ] **Manual QA per spec sec 12:**
  - Vacation Fri→Mon (22-25 May 2026) — preview = 2.
  - Vacation Thu 30/04 → Mon 04/05 2026 — preview excludes 01/05.
  - Vacation 23-25 January 2027 — preview excludes 24/01 San Feliciano.
  - Edit APPROVED with new dates — audit visible in modal, email + Telegram sent.
  - Overlap on existing leave returns 409 with detail.
  - SICK over VACATION: confirmation modal; confirm → SICK created.
  - Email subject "rol 22/05" creates ROL (not VACATION).
  - Email "ferie dal 15/04 al 18/04" sent in December returns PAST_DATE reply.

- [ ] **Push to remote** (when ready):

```bash
git push origin main
```

(Or push to a feature branch if you prefer to PR; current workflow per memory `feedback_hr_deploy_caution` favors strict prod caution.)
