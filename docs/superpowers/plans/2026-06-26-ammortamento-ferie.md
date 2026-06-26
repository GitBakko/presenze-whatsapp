# Predittore Ammortamento Ferie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-distribute each employee's residual ferie/permessi across future working days to zero the unified balance by Dec 31 (anti-collision, recalculated on each payroll upload), with full HR confirm/cancel control — plus a collateral past/future destructure of leave-usage across all charts.

**Architecture:** Build foundation-first. Phase 1 splits the balance into past-consumed vs future-approved (human vs predictor) buckets — pure-function change in `balance.ts`, then wire to charts. Phase 2 adds schema fields. Phase 3 is a pure amortization engine + a wipe-and-regenerate service. Phase 4 hooks recompute into the existing payroll-import confirm. Phase 5 builds the dedicated "Piano ammortamento" page, per-employee toggle, and predictor badges. Phase 6 validates (build/test, impeccable, Chrome E2E).

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Prisma 6 + SQLite · vitest · Tailwind 4 · Recharts.

## Global Constraints

- Schema changes via `npm run db:push` then `npm run db:generate` — NEVER `prisma migrate` (no `migrations/` dir).
- Dates/times stored as strings `"YYYY-MM-DD"` / `"HH:MM"` (Europe/Rome). Do not introduce `new Date()` into calendar logic except the injectable `now` param (pattern already in `balance.ts`).
- `LeaveRequest.source` is a free `String` — value `"PREDICTOR"` needs no enum migration. Existing values: `MANAGER`, `EXTERNAL_API`.
- Predictor touches ONLY `VACATION` and `ROL` leave types. Never SICK/BEREAVEMENT/MARRIAGE/LAW_104/MEDICAL_VISIT.
- `dailyH` for hour↔day conversion = `CONTRACT_DAILY_HOURS[contractType]` (FULL_TIME=8, PART_TIME=4) from `src/lib/employees/schedule-fallback.ts`.
- Schedule-less FULL_TIME employees → Mon-Fri fallback (`FALLBACK_WORKING_DOWS=[1,2,3,4,5]`).
- Invariant to preserve everywhere: `vacationUsed = vacationUsedPast + vacationFutureHuman + vacationFuturePredictor` (and ROL idem).
- `vacationRemaining` semantics UNCHANGED (still nets out future commitments). Only the chart labels change.
- Run `npm run build && npm test` green before each commit.
- All in-process shared state on `globalThis` (none new expected here).

---

## File Structure

**Create:**
- `src/lib/leaves/amortization.ts` — pure `planAmortization()` engine + types.
- `src/lib/leaves/amortization.test.ts` — engine unit tests.
- `src/lib/leaves/amortization-service.ts` — `recomputeAmortization()` DB orchestration (wipe + create + run record).
- `src/lib/leaves/__tests__/amortization-service.test.ts` — service tests (mock prisma).
- `src/app/api/leaves/predictor/recompute/route.ts` — manual recompute (admin).
- `src/app/api/leaves/predictor/plan/route.ts` — current plan per employee.
- `src/app/api/leaves/[id]/confirm/route.ts` — confirm a predictor day.
- `src/app/(dashboard)/leaves/amortization/page.tsx` — "Piano ammortamento" page.
- `src/app/(dashboard)/leaves/amortization/_components/*` — page sub-components.

**Modify:**
- `src/lib/leaves/balance.ts` — add `source` to `ApprovedLeaveRow`, 6 split fields to `LeaveBalanceSummary`, split tally.
- `src/lib/leaves/balance.test.ts` — split tests.
- `src/types/dashboard.ts` — extend `LeaveBalanceRow`.
- `src/app/api/stats/dashboard/route.ts` — populate split fields; fetch `source`.
- `src/app/api/leaves/balance/[employeeId]/route.ts` — (passes through, verify select includes source).
- `src/components/dashboard/LeaveBalanceTable.tsx` — 4-bucket display.
- `src/app/(dashboard)/leaves/_components/BalanceCard.tsx` — 4-bucket display.
- `src/app/(dashboard)/leaves/_components/ByEmployeeView.tsx` — 4-bucket display.
- `src/app/(dashboard)/employees/[id]/page.tsx` — 4-bucket display.
- `prisma/schema.prisma` — `Employee.leavePredictorEnabled`, `LeaveRequest.confirmedAt/confirmedById`, `LeavePredictorRun`.
- `src/lib/payroll-import-service.ts` — call `recomputeAmortization` in `confirmImport`.
- `src/app/(dashboard)/employees/[id]/edit/page.tsx` + `src/app/api/employees/[id]/route.ts` — predictor toggle.
- `src/app/(dashboard)/leaves/_components/CalendarView.tsx`, `RequestsList.tsx`, `GanttCalendar.tsx`, `types.ts` — predictor badge.
- `src/app/api/leaves/route.ts` (GET) + `calendar/route.ts` + `by-employee/route.ts` — include `confirmedAt`/`source` in payloads.

---

## PHASE 1 — Balance destructure + 4-bucket charts

### Task 1: Past/future/predictor split in `balance.ts` (pure)

**Files:**
- Modify: `src/lib/leaves/balance.ts` (interface ~91-112, `ApprovedLeaveRow` ~129-135, tally loop ~226-279)
- Test: `src/lib/leaves/balance.test.ts`

**Interfaces:**
- Consumes: existing `computeLeaveBalanceFromData(employee, balance, approvedLeaves, year, now)`.
- Produces: `LeaveBalanceSummary` gains `vacationUsedPast, vacationFutureHuman, vacationFuturePredictor, rolUsedPast, rolFutureHuman, rolFuturePredictor: number`. `ApprovedLeaveRow` gains `source?: string`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/leaves/balance.test.ts`:

```ts
import { computeLeaveBalanceFromData } from "./balance";

function ftSchedule() {
  return [1, 2, 3, 4, 5].map((dow) => ({
    dayOfWeek: dow, block1Start: "09:00", block1End: "13:00", block2Start: "14:00", block2End: "18:00",
  }));
}
const emp = { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: null, contractType: "FULL_TIME", schedule: ftSchedule() };

it("splits vacation into past vs future-human vs future-predictor", () => {
  const now = new Date("2026-06-15T12:00:00");
  const leaves = [
    { type: "VACATION", startDate: "2026-03-02", endDate: "2026-03-03", hours: null, timeSlots: null, source: "MANAGER" }, // 2 wd past
    { type: "VACATION", startDate: "2026-09-07", endDate: "2026-09-08", hours: null, timeSlots: null, source: "MANAGER" }, // 2 wd future human
    { type: "VACATION", startDate: "2026-10-05", endDate: "2026-10-05", hours: null, timeSlots: null, source: "PREDICTOR" }, // 1 wd future predictor
  ];
  const r = computeLeaveBalanceFromData(emp, null, leaves, 2026, now);
  expect(r.vacationUsedPast).toBe(2);
  expect(r.vacationFutureHuman).toBe(2);
  expect(r.vacationFuturePredictor).toBe(1);
  expect(r.vacationUsed).toBe(5);
  // invariant
  expect(r.vacationUsedPast + r.vacationFutureHuman + r.vacationFuturePredictor).toBe(r.vacationUsed);
});

it("splits a vacation spanning today into past + future portions", () => {
  const now = new Date("2026-06-15T12:00:00"); // Mon
  const leaves = [
    { type: "VACATION", startDate: "2026-06-11", endDate: "2026-06-18", hours: null, timeSlots: null, source: "MANAGER" },
  ];
  const r = computeLeaveBalanceFromData(emp, null, leaves, 2026, now);
  // working days 11,12 (Thu,Fri) + 15 (Mon today, counted past) = 3 past; 16,17,18 = 3 future
  expect(r.vacationUsedPast).toBe(3);
  expect(r.vacationFutureHuman).toBe(3);
  expect(r.vacationUsed).toBe(6);
});

it("splits ROL hours by startDate and source", () => {
  const now = new Date("2026-06-15T12:00:00");
  const leaves = [
    { type: "ROL", startDate: "2026-05-04", endDate: "2026-05-04", hours: 4, timeSlots: null, source: "MANAGER" }, // past
    { type: "ROL", startDate: "2026-08-04", endDate: "2026-08-04", hours: 8, timeSlots: null, source: "PREDICTOR" }, // future predictor
  ];
  const r = computeLeaveBalanceFromData(emp, null, leaves, 2026, now);
  expect(r.rolUsedPast).toBe(4);
  expect(r.rolFuturePredictor).toBe(8);
  expect(r.rolFutureHuman).toBe(0);
  expect(r.rolUsed).toBe(12);
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/lib/leaves/balance.test.ts`
Expected: FAIL — `vacationUsedPast` is `undefined`.

- [ ] **Step 3: Implement the split**

In `src/lib/leaves/balance.ts`:

(a) Extend `ApprovedLeaveRow` (after line 134):
```ts
export interface ApprovedLeaveRow {
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
  source?: string;
}
```

(b) Extend `LeaveBalanceSummary` — add inside the Vacation group and ROL group:
```ts
  // Vacation (days)
  vacationAccrued: number;
  vacationAccrualAdjust: number;
  vacationUsed: number;
  vacationUsedPast: number;
  vacationFutureHuman: number;
  vacationFuturePredictor: number;
  vacationCarryOver: number;
  vacationRemaining: number;
  vacationUsedThisMonth: number;
  // ROL (hours)
  rolAccrued: number;
  rolAccrualAdjust: number;
  rolUsed: number;
  rolUsedPast: number;
  rolFutureHuman: number;
  rolFuturePredictor: number;
  rolCarryOver: number;
  rolRemaining: number;
  rolUsedThisMonth: number;
```

(c) Before the tally loop (after line 224), compute today + add accumulators:
```ts
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  let vacationUsed = 0;
  let vacationUsedThisMonth = 0;
  let vacationUsedPast = 0;
  let vacationFutureHuman = 0;
  let vacationFuturePredictor = 0;
  let rolUsed = 0;
  let rolUsedThisMonth = 0;
  let rolUsedPast = 0;
  let rolFutureHuman = 0;
  let rolFuturePredictor = 0;
  let sickDays = 0;
  let sickDaysThisMonth = 0;
```
(Remove the old duplicate declarations of `vacationUsed`/`rolUsed`/etc at 226-231.)

(d) Replace the loop body (233-253):
```ts
  for (const leave of approvedLeaves) {
    const type = leave.type as LeaveType;
    const isThisMonth = leave.startDate >= monthStart && leave.startDate <= monthEnd;
    const isPredictor = leave.source === "PREDICTOR";

    if (type === "VACATION") {
      const days = countWorkDays(leave.startDate, leave.endDate, scheduleMap);
      vacationUsed += days;
      if (isThisMonth) vacationUsedThisMonth += days;
      let pastDays = 0;
      if (leave.startDate <= today) {
        const upper = leave.endDate <= today ? leave.endDate : today;
        pastDays = countWorkDays(leave.startDate, upper, scheduleMap);
      }
      const futureDays = Math.round((days - pastDays) * 100) / 100;
      vacationUsedPast += pastDays;
      if (isPredictor) vacationFuturePredictor += futureDays;
      else vacationFutureHuman += futureDays;
    } else if (type === "VACATION_HALF_AM" || type === "VACATION_HALF_PM") {
      vacationUsed += 0.5;
      if (isThisMonth) vacationUsedThisMonth += 0.5;
      if (leave.startDate <= today) vacationUsedPast += 0.5;
      else if (isPredictor) vacationFuturePredictor += 0.5;
      else vacationFutureHuman += 0.5;
    } else if (type === "SICK") {
      const days = countCalendarDays(leave.startDate, leave.endDate);
      sickDays += days;
      if (isThisMonth) sickDaysThisMonth += days;
    } else {
      const hours = leave.hours ?? 0;
      rolUsed += hours;
      if (isThisMonth) rolUsedThisMonth += hours;
      if (leave.startDate <= today) rolUsedPast += hours;
      else if (isPredictor) rolFuturePredictor += hours;
      else rolFutureHuman += hours;
    }
  }
```

(e) Add the 6 fields to the returned object (rounded):
```ts
    vacationUsedPast: Math.round(vacationUsedPast * 100) / 100,
    vacationFutureHuman: Math.round(vacationFutureHuman * 100) / 100,
    vacationFuturePredictor: Math.round(vacationFuturePredictor * 100) / 100,
    rolUsedPast: Math.round(rolUsedPast * 100) / 100,
    rolFutureHuman: Math.round(rolFutureHuman * 100) / 100,
    rolFuturePredictor: Math.round(rolFuturePredictor * 100) / 100,
```

- [ ] **Step 4: Update `computeLeaveBalance` DB query to select `source`**

In `computeLeaveBalance` (line 305-311), the `findMany` returns full rows incl. `source` already (no `select`), so `source` flows through. No change needed — verify by reading. If a `select` is present, add `source: true`.

- [ ] **Step 5: Run tests — verify pass**

Run: `npx vitest run src/lib/leaves/balance.test.ts`
Expected: PASS (all, including pre-existing).

- [ ] **Step 6: Commit**

```bash
git add src/lib/leaves/balance.ts src/lib/leaves/balance.test.ts
git commit -m "feat(leaves): split balance into past/future-human/future-predictor buckets"
```

### Task 2: Wire split into dashboard stats API + `LeaveBalanceRow`

**Files:**
- Modify: `src/types/dashboard.ts:112-122`
- Modify: `src/app/api/stats/dashboard/route.ts` (section E, ~389-448)
- Test: `src/app/api/stats/dashboard/route.ts` has no direct unit test; rely on type-check + build.

**Interfaces:**
- Consumes: `LeaveBalanceSummary` split fields from Task 1.
- Produces: `LeaveBalanceRow` gains `vacationUsedPast, vacationFutureHuman, vacationFuturePredictor: number`.

- [ ] **Step 1: Extend `LeaveBalanceRow`**

```ts
export interface LeaveBalanceRow {
  employeeId: string;
  employeeName: string;
  avatarUrl: string | null;
  vacationUsed: number;
  vacationUsedPast: number;
  vacationFutureHuman: number;
  vacationFuturePredictor: number;
  vacationTotal: number;
  vacationRemaining: number;
  vacationPercent: number;
  rolRemaining: number;
  alert: boolean;
}
```

- [ ] **Step 2: Populate in stats route**

In `src/app/api/stats/dashboard/route.ts`, where `leaveBalances.push({...})` builds the row (~431-443), add:
```ts
      vacationUsedPast: bal.vacationUsedPast,
      vacationFutureHuman: bal.vacationFutureHuman,
      vacationFuturePredictor: bal.vacationFuturePredictor,
```
Ensure the `prisma.leaveRequest.findMany` for `approvedLeavesAllYear` returns `source` (no restrictive `select`, or add `source: true`). The mapped `leavesByEmp` rows passed to `computeLeaveBalanceFromData` must carry `source`.

- [ ] **Step 3: Verify build + test**

Run: `npm run build && npm test`
Expected: build OK, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/types/dashboard.ts src/app/api/stats/dashboard/route.ts
git commit -m "feat(dashboard): expose past/future leave-usage split in stats API"
```

### Task 3: 4-bucket display in leave-usage UI surfaces

**Files:**
- Modify: `src/components/dashboard/LeaveBalanceTable.tsx`
- Modify: `src/app/(dashboard)/leaves/_components/BalanceCard.tsx`
- Modify: `src/app/(dashboard)/leaves/_components/ByEmployeeView.tsx`
- Modify: `src/app/(dashboard)/employees/[id]/page.tsx`

**Interfaces:**
- Consumes: split fields on `LeaveBalanceRow` (Task 2) and `LeaveBalanceSummary` (Task 1, served by `/api/leaves/balance/[id]`).

**Bucket semantics for display:**
- **Monte** = `vacationTotal` (carryOver+accrued+adjust). 
- **Goduti** = `vacationUsedPast`.
- **Richiesti umani futuri** = `vacationFutureHuman`.
- **Predittore futuri** = `vacationFuturePredictor`.
- Residuo disponibile = `vacationRemaining` (unchanged).

- [ ] **Step 1: `LeaveBalanceTable.tsx`** — replace the single "usate" figure with a stacked mini-legend. Read the file first; change the cell that renders `vacationUsed/vacationTotal` to render three sub-values: `Goduti {vacationUsedPast}` · `Futuri {vacationFutureHuman}` · `Pred. {vacationFuturePredictor}`, keeping the progress bar driven by `vacationPercent`. Use existing color tokens: goduti=blue-600, futuri-umani=blue-300, predittore=amber-500.

- [ ] **Step 2: `BalanceCard.tsx`** — the "Ferie residue" card subtitle currently `Maturate: {vacationAccrued} | Usate: {vacationUsed}`. Change to a 4-line breakdown: `Monte {total} · Goduti {vacationUsedPast} · Futuri {vacationFutureHuman} · Predittore {vacationFuturePredictor}`. Same for ROL using the rol* fields.

- [ ] **Step 3: `ByEmployeeView.tsx`** — `BalanceMini` subtitles currently `Mat {accrued} · Rip {carryOver} · Usa {used}`. Replace `Usa {used}` with `God {usedPast} · Fut {futureHuman} · Pred {futurePredictor}`.

- [ ] **Step 4: `employees/[id]/page.tsx`** — leave-balance cards (~240-260): same 4-bucket subtitle treatment.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: OK (no type errors). Visual polish deferred to Phase 6 impeccable.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/LeaveBalanceTable.tsx "src/app/(dashboard)/leaves/_components/BalanceCard.tsx" "src/app/(dashboard)/leaves/_components/ByEmployeeView.tsx" "src/app/(dashboard)/employees/[id]/page.tsx"
git commit -m "feat(leaves): show 4-bucket (monte/goduti/futuri-umani/predittore) usage in balance UIs"
```

---

## PHASE 2 — Schema

### Task 4: Prisma schema — predictor fields + run audit

**Files:**
- Modify: `prisma/schema.prisma` (`Employee` ~30-56, `LeaveRequest` ~127-151, new model)

- [ ] **Step 1: Add `leavePredictorEnabled` to `Employee`**

```prisma
  leavePredictorEnabled Boolean @default(false)
```

- [ ] **Step 2: Add predictor fields to `LeaveRequest`** (after `version`):

```prisma
  confirmedAt   DateTime?
  confirmedById String?
```
(Comment `source` line: `// MANAGER | EXTERNAL_API | PREDICTOR`.)

- [ ] **Step 3: Add `LeavePredictorRun` model**

```prisma
model LeavePredictorRun {
  id            String   @id @default(cuid())
  triggeredById String?
  trigger       String   // "PAYROLL_IMPORT" | "MANUAL"
  runAt         DateTime @default(now())
  year          Int
  payload       String   // JSON: per-employee { employeeId, generated, vacDays, rolDays, scrapHours }

  @@index([runAt])
}
```

- [ ] **Step 4: Push schema + regenerate client**

Run: `npm run db:push && npm run db:generate`
Expected: "Your database is now in sync", client regenerated.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: OK (Prisma types updated).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): predictor toggle, LeaveRequest.confirmedAt/By, LeavePredictorRun audit"
```

---

## PHASE 3 — Amortization engine

### Task 5: Pure `planAmortization` — pool computation

**Files:**
- Create: `src/lib/leaves/amortization.ts`
- Test: `src/lib/leaves/amortization.test.ts`

**Interfaces:**
- Produces:
```ts
export interface EmployeeAmortInput {
  id: string;
  contractType: string;            // FULL_TIME | PART_TIME
  schedule: Array<{ dayOfWeek: number; block1Start: string|null; block1End: string|null; block2Start: string|null; block2End: string|null }>;
  terminationDate: Date | null;
  vacationRemaining: number;       // days
  rolRemaining: number;            // hours
  occupiedDates: Set<string>;      // dates already taken by this employee's existing leaves
}
export interface PlannedDay { date: string; type: "VACATION" | "ROL"; hours?: number }
export interface EmployeePool { vacWholeDays: number; rolWholeDays: number; scrapHours: number; totalDays: number; dailyH: number }
export function computePool(input: EmployeeAmortInput): EmployeePool;
export function planAmortization(employees: EmployeeAmortInput[], now: Date, yearEnd: string): Map<string, PlannedDay[]>;
```

- [ ] **Step 1: Write failing pool tests**

`src/lib/leaves/amortization.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computePool } from "./amortization";

const base = { id: "e1", contractType: "FULL_TIME", schedule: [], terminationDate: null, occupiedDates: new Set<string>() };

it("unifies vacation days + ROL hours into whole days (FULL_TIME, 8h)", () => {
  // 5 vacation days = 40h, + 8h ROL = 48h => 6 whole days, 0 scrap
  const p = computePool({ ...base, vacationRemaining: 5, rolRemaining: 8 });
  expect(p.vacWholeDays).toBe(5);
  expect(p.rolWholeDays).toBe(1);
  expect(p.scrapHours).toBe(0);
  expect(p.totalDays).toBe(6);
});

it("rolls vacation fraction into the ROL pool and leaves indivisible ROL as scrap", () => {
  // 2.5 vac days => 2 whole + 0.5*8=4h into pool; rol 5h => pool 9h => 1 day + 1h scrap
  const p = computePool({ ...base, vacationRemaining: 2.5, rolRemaining: 5 });
  expect(p.vacWholeDays).toBe(2);
  expect(p.rolWholeDays).toBe(1);
  expect(p.scrapHours).toBe(1);
  expect(p.totalDays).toBe(3);
});

it("part-time uses 4h/day", () => {
  const p = computePool({ ...base, contractType: "PART_TIME", vacationRemaining: 3, rolRemaining: 4 });
  // 3 vac days + (4h/4)=1 rol day
  expect(p.vacWholeDays).toBe(3);
  expect(p.rolWholeDays).toBe(1);
  expect(p.totalDays).toBe(4);
});

it("zero residual → zero days", () => {
  const p = computePool({ ...base, vacationRemaining: 0, rolRemaining: 0 });
  expect(p.totalDays).toBe(0);
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run src/lib/leaves/amortization.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computePool`**

`src/lib/leaves/amortization.ts`:
```ts
import { CONTRACT_DAILY_HOURS } from "../employees/schedule-fallback";

export interface EmployeeAmortInput {
  id: string;
  contractType: string;
  schedule: Array<{ dayOfWeek: number; block1Start: string|null; block1End: string|null; block2Start: string|null; block2End: string|null }>;
  terminationDate: Date | null;
  vacationRemaining: number;
  rolRemaining: number;
  occupiedDates: Set<string>;
}
export interface PlannedDay { date: string; type: "VACATION" | "ROL"; hours?: number }
export interface EmployeePool { vacWholeDays: number; rolWholeDays: number; scrapHours: number; totalDays: number; dailyH: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computePool(input: EmployeeAmortInput): EmployeePool {
  const dailyH = CONTRACT_DAILY_HOURS[input.contractType] ?? 8;
  const vac = Math.max(0, input.vacationRemaining);
  const rol = Math.max(0, input.rolRemaining);
  const vacWholeDays = Math.floor(vac);
  const fracHours = r2((vac - vacWholeDays) * dailyH);
  const rolPool = r2(rol + fracHours);
  const rolWholeDays = Math.floor(rolPool / dailyH);
  const scrapHours = r2(rolPool - rolWholeDays * dailyH);
  return { vacWholeDays, rolWholeDays, scrapHours, totalDays: vacWholeDays + rolWholeDays, dailyH };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run src/lib/leaves/amortization.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leaves/amortization.ts src/lib/leaves/amortization.test.ts
git commit -m "feat(leaves): amortization pool computation (unified hour-pool → whole days)"
```

### Task 6: Pure `planAmortization` — candidate days + anti-collision

**Files:**
- Modify: `src/lib/leaves/amortization.ts`
- Modify: `src/lib/leaves/amortization.test.ts`

**Interfaces:**
- Consumes: `computePool`, `EmployeeAmortInput`, `isWorkingDay`/`addOneDay` from `./working-days` (verify exports; `isWorkingDay(date, scheduleMap)` and an internal date incrementer exist — reuse or add a local `nextDay`).
- Produces: `planAmortization(employees, now, yearEnd): Map<string, PlannedDay[]>`.

- [ ] **Step 1: Write failing tests**

```ts
import { planAmortization } from "./amortization";

function ftSched() { return [1,2,3,4,5].map(d => ({ dayOfWeek: d, block1Start:"09:00", block1End:"13:00", block2Start:"14:00", block2End:"18:00" })); }
const now = new Date("2026-12-01T12:00:00"); const yearEnd = "2026-12-31";

it("schedules exactly totalDays working days within the horizon", () => {
  const plan = planAmortization([
    { id:"e1", contractType:"FULL_TIME", schedule:ftSched(), terminationDate:null, vacationRemaining:3, rolRemaining:0, occupiedDates:new Set() },
  ], now, yearEnd);
  const days = plan.get("e1")!;
  expect(days.length).toBe(3);
  days.forEach(d => { expect(d.date > "2026-12-01").toBe(true); expect(d.date <= "2026-12-31").toBe(true); expect(d.type).toBe("VACATION"); });
});

it("first vacWholeDays are VACATION then ROL full-days carry hours=dailyH", () => {
  const plan = planAmortization([
    { id:"e1", contractType:"FULL_TIME", schedule:ftSched(), terminationDate:null, vacationRemaining:1, rolRemaining:8, occupiedDates:new Set() },
  ], now, yearEnd);
  const days = plan.get("e1")!;
  expect(days.filter(d=>d.type==="VACATION").length).toBe(1);
  const rol = days.filter(d=>d.type==="ROL");
  expect(rol.length).toBe(1); expect(rol[0].hours).toBe(8);
});

it("avoids collisions between two employees when space allows", () => {
  const plan = planAmortization([
    { id:"e1", contractType:"FULL_TIME", schedule:ftSched(), terminationDate:null, vacationRemaining:3, rolRemaining:0, occupiedDates:new Set() },
    { id:"e2", contractType:"FULL_TIME", schedule:ftSched(), terminationDate:null, vacationRemaining:3, rolRemaining:0, occupiedDates:new Set() },
  ], now, yearEnd);
  const d1 = new Set(plan.get("e1")!.map(d=>d.date));
  const overlap = plan.get("e2")!.filter(d=>d1.has(d.date));
  expect(overlap.length).toBe(0);
});

it("never schedules on or after terminationDate", () => {
  const plan = planAmortization([
    { id:"e1", contractType:"FULL_TIME", schedule:ftSched(), terminationDate:new Date("2026-12-10"), vacationRemaining:20, rolRemaining:0, occupiedDates:new Set() },
  ], now, yearEnd);
  plan.get("e1")!.forEach(d => expect(d.date < "2026-12-10").toBe(true));
});

it("skips dates the employee already has occupied", () => {
  const plan = planAmortization([
    { id:"e1", contractType:"FULL_TIME", schedule:ftSched(), terminationDate:null, vacationRemaining:2, rolRemaining:0, occupiedDates:new Set(["2026-12-02"]) },
  ], now, yearEnd);
  expect(plan.get("e1")!.some(d=>d.date==="2026-12-02")).toBe(false);
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run src/lib/leaves/amortization.test.ts -t "planAmortization|schedules|avoids|terminationDate|occupied"`
Expected: FAIL — `planAmortization` not exported.

- [ ] **Step 3: Implement `planAmortization`**

Append to `src/lib/leaves/amortization.ts`:
```ts
import { isWorkingDay } from "./working-days";
import { appliesScheduleFallback, FALLBACK_WORKING_DOWS } from "../employees/schedule-fallback";

function pad2(n: number) { return String(n).padStart(2, "0"); }
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1, 12));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function todayStr(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
function buildScheduleMap(input: EmployeeAmortInput) {
  const map = new Map<number, { block1Start: string|null; block1End: string|null; block2Start: string|null; block2End: string|null }>();
  for (const s of input.schedule) map.set(s.dayOfWeek, s);
  if (appliesScheduleFallback(input.schedule.length, input.contractType)) {
    for (const dow of FALLBACK_WORKING_DOWS) map.set(dow, { block1Start: null, block1End: null, block2Start: null, block2End: null });
  }
  return map;
}

/** Candidate working dates (today+1 .. yearEnd), respecting schedule, holidays, termination, occupied. */
export function candidateDays(input: EmployeeAmortInput, now: Date, yearEnd: string): string[] {
  const map = buildScheduleMap(input);
  const term = input.terminationDate
    ? `${input.terminationDate.getFullYear()}-${pad2(input.terminationDate.getMonth() + 1)}-${pad2(input.terminationDate.getDate())}`
    : null;
  const out: string[] = [];
  let cur = nextDay(todayStr(now));
  while (cur <= yearEnd) {
    if (
      isWorkingDay(cur, map) &&
      !input.occupiedDates.has(cur) &&
      (term === null || cur < term)
    ) out.push(cur);
    cur = nextDay(cur);
  }
  return out;
}

export function planAmortization(employees: EmployeeAmortInput[], now: Date, yearEnd: string): Map<string, PlannedDay[]> {
  // global occupancy seeded by everyone's already-occupied dates (human future leaves)
  const occupancy = new Map<string, number>();
  for (const e of employees) for (const d of e.occupiedDates) occupancy.set(d, (occupancy.get(d) ?? 0) + 1);

  // deterministic order: by id (avoids Math.random; stable across runs)
  const sorted = [...employees].sort((a, b) => a.id.localeCompare(b.id));
  const result = new Map<string, PlannedDay[]>();

  for (const emp of sorted) {
    const pool = computePool(emp);
    const planned: PlannedDay[] = [];
    if (pool.totalDays === 0) { result.set(emp.id, planned); continue; }
    const cands = candidateDays(emp, now, yearEnd);
    // sort candidates by current global occupancy (least-loaded first), tie-break by date asc
    const ranked = [...cands].sort((a, b) => {
      const oa = occupancy.get(a) ?? 0, ob = occupancy.get(b) ?? 0;
      return oa !== ob ? oa - ob : a < b ? -1 : 1;
    });
    const chosen = ranked.slice(0, pool.totalDays).sort();
    chosen.forEach((date, i) => {
      const type: "VACATION" | "ROL" = i < pool.vacWholeDays ? "VACATION" : "ROL";
      planned.push(type === "ROL" ? { date, type, hours: pool.dailyH } : { date, type });
      occupancy.set(date, (occupancy.get(date) ?? 0) + 1);
    });
    result.set(emp.id, planned);
  }
  return result;
}
```
Note: re-ranking by occupancy per employee is O(n·d log d). For ~10 employees × ~250 days it's trivial. Soft overflow is automatic: when zero-occupancy dates run out, `slice` takes the next least-loaded.

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run src/lib/leaves/amortization.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/leaves/amortization.ts src/lib/leaves/amortization.test.ts
git commit -m "feat(leaves): anti-collision day assignment for amortization plan"
```

### Task 7: `recomputeAmortization` service (wipe + create + run record)

**Files:**
- Create: `src/lib/leaves/amortization-service.ts`
- Test: `src/lib/leaves/__tests__/amortization-service.test.ts`

**Interfaces:**
- Consumes: `planAmortization`, `computeLeaveBalanceFromData`, prisma.
- Produces: `recomputeAmortization(year: number, trigger: "PAYROLL_IMPORT"|"MANUAL", actorUserId?: string): Promise<{ runId: string; created: number; perEmployee: Array<{ employeeId: string; generated: number }> }>`.

**Wipe rule (critical):** delete ONLY `source="PREDICTOR" AND confirmedAt=null AND startDate > today`. Keep past predictor days and HR-confirmed future ones.

- [ ] **Step 1: Write failing service test**

`src/lib/leaves/__tests__/amortization-service.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => {
  const db = {
    employee: { findMany: vi.fn() },
    leaveBalance: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    leavePredictorRun: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { prisma: db };
});

import { recomputeAmortization } from "../amortization-service";
import { prisma } from "../../db";

const mock = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mock.employee.findMany.mockResolvedValue([
    { id: "e1", contractType: "FULL_TIME", terminationDate: null, hireDate: new Date("2020-01-01"),
      leavePredictorEnabled: true, schedule: [1,2,3,4,5].map(d=>({dayOfWeek:d,block1Start:"09:00",block1End:"13:00",block2Start:"14:00",block2End:"18:00"})) },
  ]);
  mock.leaveBalance.findMany.mockResolvedValue([]);
  mock.leaveRequest.findMany.mockResolvedValue([]); // no existing leaves
  mock.leaveRequest.deleteMany.mockResolvedValue({ count: 0 });
  mock.leaveRequest.createMany.mockResolvedValue({ count: 0 });
  mock.leavePredictorRun.create.mockResolvedValue({ id: "run1" });
});

it("wipes only unconfirmed future predictor leaves", async () => {
  await recomputeAmortization(2026, "MANUAL", "user1");
  const call = mock.leaveRequest.deleteMany.mock.calls[0][0];
  expect(call.where.source).toBe("PREDICTOR");
  expect(call.where.confirmedAt).toBe(null);
  expect(call.where.startDate.gt).toBeDefined();
});

it("creates predictor leaves with source=PREDICTOR status=APPROVED confirmedAt=null", async () => {
  await recomputeAmortization(2026, "MANUAL", "user1");
  const created = mock.leaveRequest.createMany.mock.calls[0][0].data;
  expect(created.length).toBeGreaterThan(0);
  created.forEach((row: any) => {
    expect(row.source).toBe("PREDICTOR");
    expect(row.status).toBe("APPROVED");
    expect(row.confirmedAt).toBe(null);
  });
  expect(mock.leavePredictorRun.create).toHaveBeenCalled();
});

it("skips employees with predictor disabled", async () => {
  mock.employee.findMany.mockResolvedValue([{ id:"e2", contractType:"FULL_TIME", terminationDate:null, hireDate:new Date("2020-01-01"), leavePredictorEnabled:false, schedule:[] }]);
  await recomputeAmortization(2026, "MANUAL", "user1");
  // findMany should filter by enabled; if filtered upstream, createMany gets 0 rows
  const created = mock.leaveRequest.createMany.mock.calls[0]?.[0]?.data ?? [];
  expect(created.length).toBe(0);
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run src/lib/leaves/__tests__/amortization-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

`src/lib/leaves/amortization-service.ts`:
```ts
import { prisma } from "../db";
import { computeLeaveBalanceFromData } from "./balance";
import { planAmortization, type EmployeeAmortInput, type PlannedDay } from "./amortization";

function pad2(n: number) { return String(n).padStart(2, "0"); }

export async function recomputeAmortization(
  year: number,
  trigger: "PAYROLL_IMPORT" | "MANUAL",
  actorUserId?: string,
): Promise<{ runId: string; created: number; perEmployee: Array<{ employeeId: string; generated: number }> }> {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const yearEnd = `${year}-12-31`;
  const yearStart = `${year}-01-01`;

  const employees = await prisma.employee.findMany({
    where: { leavePredictorEnabled: true, terminationDate: null },
    include: { schedule: true },
  });
  if (employees.length === 0) {
    const run = await prisma.leavePredictorRun.create({
      data: { triggeredById: actorUserId ?? null, trigger, year, payload: "[]" },
    });
    return { runId: run.id, created: 0, perEmployee: [] };
  }

  const empIds = employees.map((e) => e.id);
  const [balances, allLeaves] = await Promise.all([
    prisma.leaveBalance.findMany({ where: { employeeId: { in: empIds }, year } }),
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: empIds }, status: "APPROVED", startDate: { gte: yearStart, lte: yearEnd } },
    }),
  ]);
  const balByEmp = new Map(balances.map((b) => [b.employeeId, b]));
  const leavesByEmp = new Map<string, typeof allLeaves>();
  for (const l of allLeaves) {
    const arr = leavesByEmp.get(l.employeeId) ?? [];
    arr.push(l);
    leavesByEmp.set(l.employeeId, arr);
  }

  // Build amort inputs from CURRENT balance (already nets out goduti + confirmed predictor).
  const inputs: EmployeeAmortInput[] = employees.map((e) => {
    const leaves = leavesByEmp.get(e.id) ?? [];
    const bal = computeLeaveBalanceFromData(
      { id: e.id, hireDate: e.hireDate, terminationDate: e.terminationDate, contractType: e.contractType, schedule: e.schedule },
      balByEmp.get(e.id) ?? null,
      leaves.map((l) => ({ type: l.type, startDate: l.startDate, endDate: l.endDate, hours: l.hours, timeSlots: l.timeSlots, source: l.source })),
      year,
      now,
    );
    // occupied = dates of all existing approved leaves (so predictor never doubles up).
    const occupied = new Set<string>();
    for (const l of leaves) {
      let cur = l.startDate;
      while (cur <= l.endDate) { occupied.add(cur); cur = nextDay(cur); }
    }
    return {
      id: e.id,
      contractType: e.contractType,
      schedule: e.schedule,
      terminationDate: e.terminationDate,
      vacationRemaining: bal.vacationRemaining,
      rolRemaining: bal.rolRemaining,
      occupiedDates: occupied,
    };
  });

  const plan = planAmortization(inputs, now, yearEnd);

  const perEmployee: Array<{ employeeId: string; generated: number }> = [];
  let created = 0;

  const runId = await prisma.$transaction(async (tx) => {
    // wipe ONLY unconfirmed future predictor leaves
    await tx.leaveRequest.deleteMany({
      where: { employeeId: { in: empIds }, source: "PREDICTOR", confirmedAt: null, startDate: { gt: today } },
    });
    const rows: Array<Record<string, unknown>> = [];
    for (const [employeeId, days] of plan) {
      perEmployee.push({ employeeId, generated: days.length });
      for (const d of days as PlannedDay[]) {
        rows.push({
          employeeId, type: d.type, startDate: d.date, endDate: d.date,
          hours: d.type === "ROL" ? d.hours ?? null : null,
          status: "APPROVED", source: "PREDICTOR", confirmedAt: null,
        });
      }
    }
    created = rows.length;
    if (rows.length > 0) await tx.leaveRequest.createMany({ data: rows as never });
    const run = await tx.leavePredictorRun.create({
      data: { triggeredById: actorUserId ?? null, trigger, year, payload: JSON.stringify(perEmployee) },
    });
    return run.id;
  });

  return { runId, created, perEmployee };
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1, 12));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run src/lib/leaves/__tests__/amortization-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/leaves/amortization-service.ts src/lib/leaves/__tests__/amortization-service.test.ts
git commit -m "feat(leaves): recomputeAmortization service (wipe unconfirmed-future + regenerate)"
```

---

## PHASE 4 — Recompute trigger

### Task 8: Hook into payroll-import confirm + manual endpoint

**Files:**
- Modify: `src/lib/payroll-import-service.ts` (`confirmImport`, ~170-256)
- Create: `src/app/api/leaves/predictor/recompute/route.ts`

**Interfaces:**
- Consumes: `recomputeAmortization` (Task 7), `checkAuth` from `src/lib/auth-guard.ts`.

- [ ] **Step 1: Call recompute after import confirm**

In `confirmImport`, AFTER the `$transaction` that upserts balances returns successfully (do NOT block the import if recompute throws), append:
```ts
  // Recompute the amortization plan on the freshly-certified balances.
  try {
    const { recomputeAmortization } = await import("./leaves/amortization-service");
    await recomputeAmortization(preview.year, "PAYROLL_IMPORT", userId);
  } catch (err) {
    logger.error({ err }, "amortization recompute after payroll import failed");
  }
```
(Use the file's existing `logger` import; if none, add `import { logger } from "./logger";` per repo convention — verify the logger module path.)

- [ ] **Step 2: Manual recompute route**

`src/app/api/leaves/predictor/recompute/route.ts`:
```ts
import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { recomputeAmortization } from "@/lib/leaves/amortization-service";

export async function POST() {
  const auth = await checkAuth();
  if (!auth.ok) return auth.response;
  const year = new Date().getFullYear();
  const result = await recomputeAmortization(year, "MANUAL", auth.userId);
  return NextResponse.json(result);
}
```
(Match the exact `checkAuth()` return shape — read `src/lib/auth-guard.ts` first; adapt `auth.ok`/`auth.response`/`auth.userId` to the real API.)

- [ ] **Step 3: Build + test**

Run: `npm run build && npm test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/payroll-import-service.ts src/app/api/leaves/predictor/recompute/route.ts
git commit -m "feat(leaves): trigger amortization recompute on payroll import + manual endpoint"
```

---

## PHASE 5 — UI

### Task 9: Per-employee predictor toggle

**Files:**
- Modify: `src/app/api/employees/[id]/route.ts` (PUT handler)
- Modify: `src/app/(dashboard)/employees/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `Employee.leavePredictorEnabled` (Task 4).

- [ ] **Step 1: Accept `leavePredictorEnabled` in PUT**

Read the PUT handler; add `leavePredictorEnabled` (boolean) to the accepted body and to the `prisma.employee.update` data. Validate with the existing zod/parse pattern in that file.

- [ ] **Step 2: Add toggle to edit form**

In `edit/page.tsx`, add a labeled checkbox/switch "Predittore ammortamento ferie" near the contract section (~405). Wire to form state and include in the PUT payload. Copy: label "Predittore ammortamento ferie", helper "Distribuisce automaticamente il residuo ferie/permessi sui giorni lavorativi futuri."

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/employees/[id]/route.ts" "src/app/(dashboard)/employees/[id]/edit/page.tsx"
git commit -m "feat(employees): per-employee leave-predictor toggle"
```

### Task 10: Predictor badge + confirm/cancel across leave views

**Files:**
- Modify: `src/app/(dashboard)/leaves/_components/types.ts` (source labels/colors)
- Modify: `src/app/(dashboard)/leaves/_components/RequestsList.tsx`, `CalendarView.tsx`, `GanttCalendar.tsx`, `ByEmployeeView.tsx`
- Modify: `src/app/api/leaves/route.ts` (GET), `calendar/route.ts`, `by-employee/route.ts` — include `confirmedAt`
- Create: `src/app/api/leaves/[id]/confirm/route.ts`

**Interfaces:**
- Produces: `POST /api/leaves/[id]/confirm` → sets `confirmedAt=now`, `confirmedById=user`, returns updated leave.
- Consumes: `source==="PREDICTOR"`, `confirmedAt` on leave payloads.

- [ ] **Step 1: Confirm route**

`src/app/api/leaves/[id]/confirm/route.ts`:
```ts
import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkAuth();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave) return NextResponse.json({ error: "Non trovata" }, { status: 404 });
  if (leave.source !== "PREDICTOR") return NextResponse.json({ error: "Solo i giorni del predittore sono confermabili" }, { status: 400 });
  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: { confirmedAt: new Date(), confirmedById: auth.userId },
  });
  return NextResponse.json(updated);
}
```
(Adapt `auth` shape to real `checkAuth()`.)

- [ ] **Step 2: Surface `confirmedAt` + `source` in GET payloads**

In `route.ts` GET map (~line 60), `calendar/route.ts` (~50), `by-employee/route.ts` (~77): ensure each serialized leave includes `source` (already) and add `confirmedAt: r.confirmedAt`.

- [ ] **Step 3: Badge + actions in `types.ts` + components**

In `types.ts` add:
```ts
export const SOURCE_LABELS: Record<string, string> = { MANAGER: "Manager", EXTERNAL_API: "API / Bot / Email", PREDICTOR: "Predittore" };
export const PREDICTOR_BADGE = "bg-amber-100 text-amber-800";
```
- `RequestsList.tsx`: Fonte column shows `SOURCE_LABELS[source]`; predictor rows get the amber badge + a "Conferma" button (calls confirm route) when `confirmedAt==null`, plus the existing delete as "Cancella".
- `CalendarView.tsx` / `GanttCalendar.tsx`: predictor events rendered with a distinct dashed border + amber tint + small "P" marker; unconfirmed predictor get reduced opacity (mirror the existing PENDING treatment).
- `ByEmployeeView.tsx`: predictor requests labelled "Predittore" with confirm/cancel actions.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/leaves/_components" "src/app/api/leaves/route.ts" "src/app/api/leaves/calendar/route.ts" "src/app/api/leaves/by-employee/route.ts" "src/app/api/leaves/[id]/confirm/route.ts"
git commit -m "feat(leaves): predictor badge + confirm/cancel across calendar, list, gantt, by-employee"
```

### Task 11: "Piano ammortamento" page + plan API

**Files:**
- Create: `src/app/api/leaves/predictor/plan/route.ts`
- Create: `src/app/(dashboard)/leaves/amortization/page.tsx`
- Create: `src/app/(dashboard)/leaves/amortization/_components/PlanByEmployee.tsx`
- Modify: leaves page nav / breadcrumb to link the new page.

**Interfaces:**
- Produces: `GET /api/leaves/predictor/plan?year=` → per enabled employee: `{ employeeId, name, vacationRemaining, rolRemaining, pool: {vacWholeDays, rolWholeDays, scrapHours, totalDays}, days: Array<{id, date, type, hours, confirmedAt}> }`.

- [ ] **Step 1: Plan API**

`src/app/api/leaves/predictor/plan/route.ts`: `checkAuth` (admin). Load `employee.findMany({ where:{ leavePredictorEnabled:true }, include:{ schedule:true } })`. For each, compute balance (`computeLeaveBalance`), `computePool`, and fetch its `source="PREDICTOR"` leaves for the year (`id, startDate, type, hours, confirmedAt`). Return the array.

- [ ] **Step 2: Page + component**

`amortization/page.tsx` (server or client per repo convention; the leaves page is client — mirror it). Renders:
- Header "Piano ammortamento" + global "Ricalcola" button → `POST /api/leaves/predictor/recompute`, then refetch.
- `PlanByEmployee` cards: per employee — residuo (monte ore unico = `vacationRemaining*dailyH + rolRemaining`), `totalDays` pianificati, `scrapHours` scarto, count confermati vs da confermare, collision indicator. List of predictor days with per-row **Conferma** (`POST /api/leaves/[id]/confirm`) and **Cancella** (`DELETE /api/leaves/[id]`), plus **"Conferma tutti"** bulk.
- Use `useNotificationsContext` to refetch on `LEAVE_*`/`LEAVE_AMORTIZATION` events (mirror leaves page pattern).

- [ ] **Step 3: Link in nav**

Add a link/tab to `/leaves/amortization` from the leaves page header or the dashboard sidebar (follow existing nav pattern).

- [ ] **Step 4: Build + test**

Run: `npm run build && npm test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/leaves/predictor/plan/route.ts" "src/app/(dashboard)/leaves/amortization"
git commit -m "feat(leaves): Piano ammortamento page — review, confirm/cancel, recompute"
```

---

## PHASE 6 — Validation

### Task 12: Build/test green, impeccable audit, Chrome E2E

**Files:** none (validation only); fixes land in the relevant files.

- [ ] **Step 1: Full gate**

Run: `npm run build && npm test && npm run lint`
Expected: all green. Fix any failures before continuing.

- [ ] **Step 2: impeccable audit on new frontend**

Invoke `impeccable:audit` on the new/changed frontend: `amortization` page + components, predictor badges, 4-bucket balance UIs. Address accessibility/theming/responsive findings; re-run `impeccable:polish`/`critique` as needed. Keep xlsx/byte-identical exports untouched.

- [ ] **Step 3: Smoke + E2E via Chrome plugin**

Start dev server (`npm run dev`). Using claude-in-chrome (load tools via ToolSearch), drive and GIF-record:
1. Login as admin.
2. Toggle predictor ON for a test employee (edit page).
3. Manual "Ricalcola" on Piano ammortamento → plan appears, days = pool.totalDays, scrap shown.
4. Confirm one day, cancel another → counts update; balance UIs reflect predictor-future bucket.
5. Open dashboard → verify 4-bucket leave-usage (goduti = past only; future-human + predictor distinct).
6. (If feasible) upload a payroll PDF → verify plan recomputes, confirmed days survive, unconfirmed regenerate.

Save GIFs as `amortization_e2e_*.gif`. Capture console for errors (`read_console_messages`).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test(leaves): impeccable audit fixes + E2E validation for amortization predictor"
```

---

## Self-Review (author checklist — completed)

- **Spec coverage:** D1→Task5/6 (zero by Dec31 horizon), D2→Task6 (uniform+anti-collision), D3→Task5 (unified pool+scrap), D4→phase order (1 before 3), D5→Task4+7 (PREDICTOR source+confirmedAt), D6→Task11 (dedicated page), D7→Task1-3 (4 buckets), D8→Task6 (soft overflow), D9→Task8 (payroll trigger), D10→Task7 (wipe unconfirmed-future only). Collateral chart split → Tasks 1-3. Toggle → Tasks 4+9. Validation → Task12.
- **Placeholder scan:** all code steps contain real code; UI tasks (3,9,10,11) reference exact files + concrete copy/colors; "read the file first" notes are for adapting to real signatures (auth-guard shape), not deferred logic.
- **Type consistency:** `EmployeeAmortInput`, `PlannedDay`, `EmployeePool`, `computePool`, `planAmortization`, `recomputeAmortization` signatures consistent across Tasks 5-8. `vacation*`/`rol*` split field names identical in Tasks 1-3. `confirmedAt`/`confirmedById` consistent Tasks 4,7,10.
- **Known adaptation points (verify at execution, not blockers):** exact `checkAuth()` return shape; `logger` import path in payroll-import-service; presence/absence of `select` in existing leave queries; client-vs-server component convention for the new page.
