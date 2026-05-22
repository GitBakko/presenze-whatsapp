# Dashboard N+1 Elimination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the ~3N+8 query waterfall in `/api/stats/dashboard` by extracting `computeLeaveBalance` into a pure compute function, batching the per-employee balance queries into 3 super-queries, and replacing the 8-month sequential chart loop with a single range query.

**Architecture:** Three-step refactor. Task 1 adds a pure `computeLeaveBalanceFromData` function alongside the existing DB wrapper, protected by 8 regression tests covering every accrual + leave-type code path. Task 2 keeps the public `computeLeaveBalance` wrapper byte-compatible but routes it through the pure function. Tasks 3-4 rewrite the two N+1 loops in the dashboard route to fetch all data up-front and call the pure function over an in-memory map.

**Tech Stack:** TypeScript strict, Next.js 16 App Router, Prisma 6 (SQLite), Vitest 4. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-05-22-dashboard-n+1-design.md`

---

## File Structure

**New files:**
| Path | Responsibility |
|------|----------------|
| `src/lib/leaves/balance.test.ts` | 8 regression tests for `computeLeaveBalanceFromData` |

**Modified files:**
| Path | Change |
|------|--------|
| `src/lib/leaves/balance.ts` | Add pure `computeLeaveBalanceFromData(employee, balance, approvedLeaves, year, now?)`. Refactor public `computeLeaveBalance` wrapper to delegate to it. |
| `src/app/api/stats/dashboard/route.ts` | Add `hireDate` to the `allEmployees` select. Section E: replace per-emp `await computeLeaveBalance(...)` loop with 2 batch queries + in-memory loop calling the pure function. `computeOreChart`: replace 8 serial `attendanceRecord.findMany` calls with 1 range query + in-memory grouping. |

---

## Task 1: Extract `computeLeaveBalanceFromData` pure function with regression tests

**Files:**
- Create: `src/lib/leaves/balance.test.ts`
- Modify: `src/lib/leaves/balance.ts`

The goal of this task is to extract the body of `computeLeaveBalance` from line 130 onward into a sync pure function. The new function takes pre-fetched data, the existing wrapper keeps its signature and delegates to it. Eight regression tests anchor the computed-values contract before the refactor is allowed to land. TDD-first.

- [ ] **Step 1: Write failing tests**

Create `src/lib/leaves/balance.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeLeaveBalanceFromData } from "./balance";

type ScheduleRow = {
  dayOfWeek: number;
  block1Start: string | null;
  block1End: string | null;
  block2Start: string | null;
  block2End: string | null;
};

function fullTimeSchedule(): ScheduleRow[] {
  // 8h/day Mon-Fri (1=Mon..5=Fri in ISO), 40h/week
  return [1, 2, 3, 4, 5].map((dow) => ({
    dayOfWeek: dow,
    block1Start: "09:00",
    block1End: "13:00",
    block2Start: "14:00",
    block2End: "18:00",
  }));
}

function partTimeSchedule24h(): ScheduleRow[] {
  // 8h Mon, 8h Tue, 8h Wed only → 24h/week
  return [1, 2, 3].map((dow) => ({
    dayOfWeek: dow,
    block1Start: "09:00",
    block1End: "13:00",
    block2Start: "14:00",
    block2End: "18:00",
  }));
}

describe("computeLeaveBalanceFromData", () => {
  it("FULL_TIME hired before this year, no leaves, no balance → 12 months accrued at year end", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationAccrued).toBe(24); // 12 * 2 days/month for full-time
    expect(r.rolAccrued).toBe(24); // 12 * 2 hours/month for full-time
    expect(r.vacationUsed).toBe(0);
    expect(r.rolUsed).toBe(0);
    expect(r.vacationCarryOver).toBe(0);
    expect(r.weeklyHours).toBe(40);
  });

  it("FULL_TIME hired June this year, now=December same year → 7 months accrued", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2026-06-15"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    // June=month 5, December=month 11 → 11 - 5 + 1 = 7
    expect(r.vacationAccrued).toBe(14); // 7 * 2
    expect(r.rolAccrued).toBe(14);
  });

  it("PART_TIME 24h/wk with schedule rows → accrual proportional to 24/40", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e2", hireDate: new Date("2020-01-01"), contractType: "PART_TIME", schedule: partTimeSchedule24h() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    // weeklyHours = 24 → ratio = 24/40 = 0.6 → monthly vacation = 2 * 0.6 = 1.2
    expect(r.weeklyHours).toBe(24);
    expect(r.vacationAccrued).toBeCloseTo(14.4, 2); // 12 * 1.2
    expect(r.rolAccrued).toBeCloseTo(14.4, 2);
  });

  it("PART_TIME without schedule rows → accrual=0, no throw (known limitation)", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e3", hireDate: new Date("2020-01-01"), contractType: "PART_TIME", schedule: [] },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.weeklyHours).toBe(0);
    expect(r.vacationAccrued).toBe(0);
    expect(r.rolAccrued).toBe(0);
  });

  it("Hired previous year with carryOver=10 and accrualAdjust=+2 → totals include both", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      {
        vacationCarryOver: 10,
        rolCarryOver: 5,
        vacationAccrualAdjust: 2,
        rolAccrualAdjust: 1,
      },
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationCarryOver).toBe(10);
    expect(r.vacationAccrualAdjust).toBe(2);
    // remaining = carry + accrued + adjust - used = 10 + 24 + 2 - 0 = 36
    expect(r.vacationRemaining).toBe(36);
    expect(r.rolRemaining).toBe(30); // 5 + 24 + 1 - 0
  });

  it("1 leave VACATION 5 working-days APPROVED → vacationUsed=5", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [{
        type: "VACATION",
        startDate: "2026-06-01",  // Monday
        endDate: "2026-06-05",    // Friday → 5 working days
        hours: null,
        timeSlots: null,
      }],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationUsed).toBe(5);
    expect(r.vacationRemaining).toBe(19); // 24 - 5
  });

  it("1 leave ROL hours=4 APPROVED → rolUsed=4", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [{
        type: "ROL",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hours: 4,
        timeSlots: null,
      }],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.rolUsed).toBe(4);
    expect(r.rolRemaining).toBe(20); // 24 - 4
  });

  it("VACATION_HALF_AM counted as 0.5 days", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [{
        type: "VACATION_HALF_AM",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hours: null,
        timeSlots: '[{"from":"09:00","to":"13:00"}]',
      }],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationUsed).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/lib/leaves/balance.test.ts`
Expected: FAIL — `computeLeaveBalanceFromData` not exported.

- [ ] **Step 3: Add the pure function alongside the existing wrapper**

Open `src/lib/leaves/balance.ts`. Below the existing `LeaveBalanceSummary` interface (after line 111) and BEFORE the existing `computeLeaveBalance` async function (line 117), insert:

```typescript
export interface EmployeeForBalance {
  id: string;
  hireDate: Date | null;
  contractType: string;
  schedule: Array<ScheduleBlock & { dayOfWeek: number }>;
}

export interface BalanceAdjustments {
  vacationCarryOver: number;
  rolCarryOver: number;
  vacationAccrualAdjust: number;
  rolAccrualAdjust: number;
}

export interface ApprovedLeaveRow {
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
}

/**
 * Pure (no DB) compute of the leave balance from already-fetched data.
 * Use this when you have many employees' data in memory and want to
 * avoid the per-employee query waterfall. The `now` argument is
 * injectable for deterministic tests.
 */
export function computeLeaveBalanceFromData(
  employee: EmployeeForBalance,
  balance: BalanceAdjustments | null,
  approvedLeaves: ApprovedLeaveRow[],
  year: number,
  now: Date = new Date(),
): LeaveBalanceSummary {
  const weeklyHours = employee.schedule.length > 0
    ? calcWeeklyHours(employee.schedule)
    : (employee.contractType === "FULL_TIME" ? FULL_TIME_WEEKLY_HOURS : 0);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-based

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

  const vacationCarryOver = balance?.vacationCarryOver ?? 0;
  const rolCarryOver = balance?.rolCarryOver ?? 0;
  const vacationAccrualAdjust = balance?.vacationAccrualAdjust ?? 0;
  const rolAccrualAdjust = balance?.rolAccrualAdjust ?? 0;

  const monthStart = `${year}-${String(currentMonth + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(currentMonth + 1).padStart(2, "0")}-31`;

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
```

Note: `countCalendarDays` and `parseDate` are private to this file (defined at the bottom). They remain in-scope for the pure function since it lives in the same module. The `EmployeeForBalance.schedule` type intersects `ScheduleBlock` with `{ dayOfWeek: number }` because the Prisma `EmployeeSchedule` rows returned by `include: { schedule: true }` carry both block times AND `dayOfWeek` — keeping this in the type lets the pure function read `s.dayOfWeek` without casts.

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/lib/leaves/balance.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leaves/balance.ts src/lib/leaves/balance.test.ts
git commit -m "feat(perf): extract computeLeaveBalanceFromData pure function with regression tests (H4 task 1)"
```

---

## Task 2: Route the `computeLeaveBalance` wrapper through the pure function

**Files:**
- Modify: `src/lib/leaves/balance.ts`

Keep the public async signature byte-compatible. The wrapper is now thin: it fetches, then delegates. `payroll-import-service.ts` (the existing consumer) continues to work without modification.

- [ ] **Step 1: Replace the body of `computeLeaveBalance`**

Open `src/lib/leaves/balance.ts`. Locate the `export async function computeLeaveBalance(employeeId, year)` declaration (originally line 117). Replace the ENTIRE body of that function with this minimal wrapper:

```typescript
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

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [balance, approvedLeaves] = await Promise.all([
    prisma.leaveBalance.findUnique({
      where: { employeeId_year: { employeeId, year } },
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: "APPROVED",
        startDate: { gte: yearStart, lte: yearEnd },
      },
    }),
  ]);

  return computeLeaveBalanceFromData(
    {
      id: employee.id,
      hireDate: employee.hireDate,
      contractType: employee.contractType,
      schedule: employee.schedule,
    },
    balance,
    approvedLeaves,
    year,
  );
}
```

- [ ] **Step 2: Run the full vitest suite to confirm baseline holds**

Run: `npx vitest run`
Expected: same baseline as before (the new 8 balance tests pass; the 1 pre-existing `calculator.test.ts` failure persists). All other test suites pass.

- [ ] **Step 3: Smoke-check the public consumer**

Open `src/lib/payroll-import-service.ts`. Confirm the call site at line 98 (`await computeLeaveBalance(emp.id, parsed.year)`) is unchanged and the import path still resolves.

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 7 (same pre-existing baseline).

- [ ] **Step 4: Commit**

```bash
git add src/lib/leaves/balance.ts
git commit -m "refactor(perf): route computeLeaveBalance wrapper through pure function (H4 task 2)"
```

---

## Task 3: Replace the per-employee balance loop in the dashboard route with a batch fetch

**Files:**
- Modify: `src/app/api/stats/dashboard/route.ts`

The dashboard's Section E currently does `await computeLeaveBalance(emp.id, currentYear)` inside a `for` loop — 3 sequential queries per employee. Refactor it to fetch all balances + all approved leaves in 2 queries (in parallel), build per-employee maps, then call the pure function in-memory.

This task also widens the `allEmployees` select to include `hireDate` (needed by the pure function).

- [ ] **Step 1: Widen the `allEmployees` select to include `hireDate`**

In `src/app/api/stats/dashboard/route.ts`, locate the `prisma.employee.findMany` call inside the `Promise.all([` block (around line 86):

Replace:
```typescript
    prisma.employee.findMany({
      select: { id: true, name: true, displayName: true, avatarUrl: true, contractType: true },
    }),
```

With:
```typescript
    prisma.employee.findMany({
      select: { id: true, name: true, displayName: true, avatarUrl: true, contractType: true, hireDate: true },
    }),
```

- [ ] **Step 2: Build a per-employee schedule-rows map for the pure function**

Inside the route handler, AFTER the existing `scheduleMap` construction (line 149-156 builds `Map<string, Map<number, EmployeeScheduleDay>>`), add a parallel array map for the pure function consumption:

```typescript
  // Flat per-employee schedule rows (with dayOfWeek) for computeLeaveBalanceFromData
  const scheduleRowsByEmp = new Map<string, typeof schedules>();
  for (const s of schedules) {
    const arr = scheduleRowsByEmp.get(s.employeeId) ?? [];
    arr.push(s);
    scheduleRowsByEmp.set(s.employeeId, arr);
  }
```

- [ ] **Step 3: Update the import line to add the pure function**

At the top of the file, find:

```typescript
import { computeLeaveBalance } from "@/lib/leaves";
```

Replace with:

```typescript
import { computeLeaveBalance, computeLeaveBalanceFromData } from "@/lib/leaves";
```

Then open `src/lib/leaves/index.ts` and confirm `computeLeaveBalanceFromData` is re-exported. If not, add `export { computeLeaveBalanceFromData } from "./balance";` (or whatever the existing re-export style is — use a grep to discover):

```bash
grep -n "export" src/lib/leaves/index.ts
```

If the index re-exports via `export * from "./balance"`, no edit is needed.

- [ ] **Step 4: Replace the Section E loop**

Locate the `// ── SEZIONE E — Saldi ferie/ROL` block (line 377). Replace the existing code from `const leaveBalances: LeaveBalanceRow[] = [];` down to (but NOT including) `leaveBalances.sort((a, b) => a.employeeName.localeCompare(b.employeeName));` with:

```typescript
  // ── SEZIONE E — Saldi ferie/ROL ────────────────────────────────────
  const leaveBalances: LeaveBalanceRow[] = [];
  const isH2 = currentMonth >= 6;

  const empIds = allEmployees.map((e) => e.id);
  const yearStartIso = `${currentYear}-01-01`;
  const yearEndIso = `${currentYear}-12-31`;

  const [balanceRows, approvedLeavesAllYear] = await Promise.all([
    prisma.leaveBalance.findMany({
      where: { employeeId: { in: empIds }, year: currentYear },
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: empIds },
        status: "APPROVED",
        startDate: { gte: yearStartIso, lte: yearEndIso },
      },
    }),
  ]);

  const balanceByEmp = new Map(balanceRows.map((b) => [b.employeeId, b]));
  const leavesByEmp = new Map<string, typeof approvedLeavesAllYear>();
  for (const l of approvedLeavesAllYear) {
    const arr = leavesByEmp.get(l.employeeId) ?? [];
    arr.push(l);
    leavesByEmp.set(l.employeeId, arr);
  }

  for (const emp of allEmployees) {
    try {
      const bal = computeLeaveBalanceFromData(
        {
          id: emp.id,
          hireDate: emp.hireDate,
          contractType: emp.contractType,
          schedule: scheduleRowsByEmp.get(emp.id) ?? [],
        },
        balanceByEmp.get(emp.id) ?? null,
        leavesByEmp.get(emp.id) ?? [],
        currentYear,
      );
      const vacTotal = bal.vacationCarryOver + bal.vacationAccrued + bal.vacationAccrualAdjust;
      const vacPercent = vacTotal > 0 ? (bal.vacationUsed / vacTotal) * 100 : 0;
      leaveBalances.push({
        employeeId: emp.id,
        employeeName: emp.displayName || emp.name,
        avatarUrl: emp.avatarUrl,
        vacationUsed: bal.vacationUsed,
        vacationTotal: Math.round(vacTotal * 100) / 100,
        vacationRemaining: bal.vacationRemaining,
        vacationPercent: Math.round(vacPercent * 10) / 10,
        rolRemaining: bal.rolRemaining,
        alert: isH2 && bal.vacationRemaining < 5,
      });
    } catch {
      // skip employees without valid schedule
    }
  }
  leaveBalances.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
```

- [ ] **Step 5: Drop the now-unused import if the wrapper is no longer called from this file**

If `computeLeaveBalance` (the async wrapper, not `computeLeaveBalanceFromData`) is no longer referenced anywhere in `route.ts`, simplify the import to just `computeLeaveBalanceFromData`:

```typescript
import { computeLeaveBalanceFromData } from "@/lib/leaves";
```

Run: `grep -n "computeLeaveBalance\b" src/app/api/stats/dashboard/route.ts`
If only the import line and no further usages, drop `computeLeaveBalance` from the import.

- [ ] **Step 6: Typecheck + full vitest**

Run in parallel:
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → expect 7 (pre-existing baseline).
- `npx vitest run` → expect same pass count + 1 pre-existing calculator fail.

- [ ] **Step 7: Manual equivalence check**

Start dev server (`npm run dev`), log in as admin, open `/api/stats/dashboard?period=month&chart=all` in a browser tab. Save the JSON to `/tmp/dashboard-after-task3.json`.

Then `git stash`, restart dev server, save the pre-refactor JSON to `/tmp/dashboard-before-task3.json`. `git stash pop`.

```bash
diff <(jq -S . /tmp/dashboard-before-task3.json) <(jq -S . /tmp/dashboard-after-task3.json)
```

Expected: empty diff (or only `kpi.delta` differs by rounding artifacts on long-tail edges). If unexpected diffs appear, STOP and inspect — the pure function may be misreading one of the data shapes.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/stats/dashboard/route.ts src/lib/leaves/index.ts
git commit -m "perf(dashboard): batch leave-balance fetch (3N→2 queries) (H4 task 3)"
```

(Drop `src/lib/leaves/index.ts` from the `git add` if it wasn't touched.)

---

## Task 4: Replace the 8-month sequential chart loop with one range query

**Files:**
- Modify: `src/app/api/stats/dashboard/route.ts`

The `computeOreChart` function (line 597+) loops over `months` (default 8) and runs one `attendanceRecord.findMany` per month. Refactor to one range query covering the full window, then group records in-memory by `YYYY-MM`.

- [ ] **Step 1: Replace the `computeOreChart` body**

Locate `async function computeOreChart(months, scheduleMap, allEmployees, dismissedSet, filterEmployeeId?)` (around line 597). Replace its body with:

```typescript
async function computeOreChart(
  months: number,
  scheduleMap: Map<string, Map<number, EmployeeScheduleDay>>,
  allEmployees: { id: string; contractType: string }[],
  dismissedSet: Set<string>,
  filterEmployeeId?: string | null,
): Promise<OreChartPoint[]> {
  const now = new Date();
  const points: OreChartPoint[] = [];

  // Range = first day of (now - (months-1) months) → last day of current month
  const earliestMonthFirst = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const latestMonthLast = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const rangeFrom =
    `${earliestMonthFirst.getFullYear()}-` +
    `${String(earliestMonthFirst.getMonth() + 1).padStart(2, "0")}-01`;
  const rangeTo =
    `${latestMonthLast.getFullYear()}-` +
    `${String(latestMonthLast.getMonth() + 1).padStart(2, "0")}-` +
    `${String(latestMonthLast.getDate()).padStart(2, "0")}`;

  const recordsWhere: Record<string, unknown> = { date: { gte: rangeFrom, lte: rangeTo } };
  if (filterEmployeeId) recordsWhere.employeeId = filterEmployeeId;

  const allRecords = await prisma.attendanceRecord.findMany({
    where: recordsWhere,
    include: { employee: true },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });

  const recordsByMonth = new Map<string, typeof allRecords>();
  for (const r of allRecords) {
    const ym = r.date.slice(0, 7); // 'YYYY-MM'
    const arr = recordsByMonth.get(ym) ?? [];
    arr.push(r);
    recordsByMonth.set(ym, arr);
  }

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    const ymKey = `${y}-${String(m).padStart(2, "0")}`;

    // Ore contratto: somma delle ore giornaliere di ogni dipendente per i giorni lavorativi del mese
    let contratto = 0;
    for (const emp of allEmployees) {
      const empSched = scheduleMap.get(emp.id);
      for (let day = 1; day <= lastDay; day++) {
        const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (isNonWorkingDay(dateStr)) continue;
        const dow = getDayOfWeek(dateStr);
        const sched = empSched?.get(dow);
        if (sched) {
          let mins = 0;
          if (sched.block1Start && sched.block1End)
            mins += hmToMinutes(sched.block1End) - hmToMinutes(sched.block1Start);
          if (sched.block2Start && sched.block2End)
            mins += hmToMinutes(sched.block2End) - hmToMinutes(sched.block2Start);
          contratto += mins / 60;
        } else if (!empSched || empSched.size === 0) {
          contratto += 8;
        }
      }
    }

    // Ore lavorate: read from the in-memory map (was a per-month query before)
    const monthRecords = recordsByMonth.get(ymKey) ?? [];

    const grouped = new Map<string, DailyRecord>();
    for (const r of monthRecords) {
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
    let lavorate = 0;
    for (const dr of grouped.values()) {
      const dow = getDayOfWeek(dr.date);
      const empSchedule = scheduleMap.get(dr.employeeId)?.get(dow) ?? null;
      const s = calculateDailyStats(dr, empSchedule);
      s.anomalies = s.anomalies.filter(
        (a) => !dismissedSet.has(`${s.employeeId}|${s.date}|${a.type}|${a.description}`)
      );
      lavorate += s.hoursWorked;
    }

    points.push({
      mese: MESI_ABBR[m],
      contratto: Math.round(contratto),
      lavorate: Math.round(lavorate),
    });
  }

  return points;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 7 (pre-existing baseline).

- [ ] **Step 3: Full vitest**

Run: `npx vitest run`
Expected: same pass count as Task 3 baseline + 1 pre-existing calculator fail.

- [ ] **Step 4: Manual equivalence check (with chart)**

Dev server. As admin, fetch `/api/stats/dashboard?period=month&chart=all&months=8`. Save JSON to `/tmp/dashboard-chart-after.json`.

`git stash`, restart, save pre-refactor → `/tmp/dashboard-chart-before.json`. `git stash pop`.

```bash
diff <(jq -S '.charts.oreMensili' /tmp/dashboard-chart-before.json) <(jq -S '.charts.oreMensili' /tmp/dashboard-chart-after.json)
```

Expected: empty diff. If a month differs, the `slice(0, 7)` `YYYY-MM` key likely doesn't match a record whose date column is stored in a different format — inspect a sample record and adjust.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/stats/dashboard/route.ts
git commit -m "perf(dashboard): single range query for 8-month ore chart (H4 task 4)"
```

---

## Task 5: Final verification + perf measurement + push

**Files:** no source changes (verification only).

- [ ] **Step 1: Confirm full baseline still holds**

Run in parallel:
- `npm run lint 2>&1 | tail -20` → 0 errors (2 pre-existing warnings OK).
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 7 (pre-existing baseline).
- `npx vitest run 2>&1 | tail -10` → previous suite + 8 new balance tests, 1 pre-existing calculator fail.

- [ ] **Step 2: Local perf measurement**

In `src/app/api/stats/dashboard/route.ts`, AT THE TOP of the `GET` handler body (after the auth checks), temporarily add:

```typescript
  const __perfStart = Date.now();
```

AND AT THE FINAL `return NextResponse.json(...)` line, temporarily add a `console.log` immediately before:

```typescript
  console.log(`[dashboard] ${Date.now() - __perfStart}ms`);
```

Restart dev server. Open dashboard logged in as admin 3 times, watch the terminal. Record the median time.

Then `git stash` (to compare pre-refactor), restart dev, re-open dashboard 3 times, record the median.

`git stash pop`.

Document numbers in the final commit message (Step 5).

- [ ] **Step 3: Remove temporary perf logs**

Use Edit tool to remove the two temporary lines from `src/app/api/stats/dashboard/route.ts`:
- the `const __perfStart = Date.now();` line
- the `console.log(\`[dashboard] ${Date.now() - __perfStart}ms\`);` line

Verify with: `grep -n "__perfStart" src/app/api/stats/dashboard/route.ts`
Expected: empty.

- [ ] **Step 4: Lint must remain clean**

Run: `npm run lint 2>&1 | tail -5`
Expected: 0 errors. (Confirms no leftover `console.*` in route.ts.)

- [ ] **Step 5: Final commit + push**

```bash
git add -A docs/superpowers/specs/2026-05-22-dashboard-n+1-design.md docs/superpowers/plans/2026-05-22-dashboard-n+1.md
git status
```

If there are uncommitted spec/plan changes, commit them first with a doc commit. Otherwise:

```bash
git push origin main
```

Document in the push message (or follow-up commit) the local perf numbers from Step 2:

```bash
git commit --allow-empty -m "perf(dashboard): H4 phase complete

Local dev DB (~15 employees), median over 3 hits:
- Before: <PRE_MEDIAN>ms
- After:  <POST_MEDIAN>ms
- Reduction: <PCT>%"
```

(Replace `<PRE_MEDIAN>`, `<POST_MEDIAN>`, `<PCT>` with the actual numbers from Step 2.)

---

## Post-implementation

- Update `C:\Users\bakko\.claude\projects\D--Develop-AI-Hr\memory\session_2026-05-22_resume.md` with the H4 completion entry.
- Update `project_hr_tech_debt_tasklist.md`: mark H4 DONE.
- Next G4 sub-phase candidates (per spec section 9): H11 employees over-fetch, M3 tz.ts coverage sweep, M11 schema hardening, or H10 RSC migration brainstorming.
