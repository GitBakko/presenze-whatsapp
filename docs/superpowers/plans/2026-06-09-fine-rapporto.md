# Fine Rapporto (Employee Termination) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark an employee terminated on an inclusive last-active date `X` so they drop out of every forward-looking KPI/control/export/report from `X` and accrual stops, while all history before `X` is preserved and the action is reversible.

**Architecture:** A nullable `terminationDate` on `Employee` is the single source of truth (`isActive = terminationDate == null`, never stored). A tiny pure primitive `src/lib/employees/active.ts` (`isActiveOn` + `activeOnWhere`) is plugged into the central choke points (dashboard, monthly report, leave dropdowns, accrual). Write paths (punches, leave creation, anomaly sync) reject/suppress post-termination mutations. A thin termination route delegates to a pure `planTermination` domain function. Routes that hit Prisma stay thin wrappers over tested pure lib functions (this repo has no test-DB harness — same pattern as `computeLeaveBalanceFromData` pure + `computeLeaveBalance` wrapper).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 6 + SQLite, NextAuth v5, vitest, Tailwind 4.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `prisma/schema.prisma` | Modify | Add `terminationDate`, `terminationReason`, `terminatedById`, `terminatedAt` to `Employee` + `terminatedBy`/`terminatedEmployees` relation |
| `src/lib/employees/active.ts` | Create | Pure `isActiveOn(emp, dateIso)` + `activeOnWhere(dateIso)` Prisma where-fragment |
| `src/lib/employees/active.test.ts` | Create | Exhaustive boundary tests for the primitive |
| `src/lib/leaves/balance.ts` | Modify | Add `terminationDate` to `EmployeeForBalance`; cap `monthsAccrued` at termination month; pass `terminationDate` at the wrapper call site |
| `src/lib/leaves/balance.test.ts` | Modify | Accrual-cap regression tests |
| `src/lib/employees/termination.ts` | Create | Pure `planTermination(...)` → `{ updateData, warnings }` (or throws); `isTerminatedOnDate` helper |
| `src/lib/employees/termination.test.ts` | Create | Unit tests for `planTermination` + `isTerminatedOnDate` |
| `src/app/api/employees/[id]/termination/route.ts` | Create | `POST` terminate / `DELETE` reactivate — thin wrappers over `planTermination` |
| `src/lib/excel-presenze.ts` | Modify | `buildPresenzeMonthData` employee query → `select` term fields + `activeOnWhere(monthEnd)` |
| `src/app/api/stats/dashboard/route.ts` | Modify | `allEmployees` select + `isActiveOn(today)` filter; per-month `isActiveOn(monthEnd)` in `computeOreChart`; pass `terminationDate` to `computeLeaveBalanceFromData` |
| `src/app/api/leaves/by-employee/route.ts` | Modify | `activeOnWhere(today)` on employee query |
| `src/app/api/settings/users/route.ts` | Modify | `activeOnWhere(today)` on the employee dropdown query |
| `src/app/api/employees/route.ts` | Modify | `withoutPayrollId` picker → `activeOnWhere(today)`; main `GET` returns `terminationDate` (UI handles hide) |
| `src/lib/anomaly-sync.ts` | Modify | Batch-load `Map<employeeId, terminationDate>`; suppress + skip stale-cleanup for terminated days via `shouldSuppressAnomaly` |
| `src/app/api/kiosk/punch/route.ts` | Modify | Reject NFC punch when terminated as-of `date` |
| `src/lib/telegram-handlers.ts` | Modify | Reject `doPunch` when terminated as-of `date` (leave/read commands unaffected) |
| `src/app/api/import/upload/route.ts` | Modify | Skip imported records dated after `terminationDate` |
| `src/app/api/leaves/route.ts` | Modify | Reject leave whose `startDate > terminationDate` |
| `src/app/api/external/leaves/route.ts` | Modify | Reject leave whose `startDate > terminationDate` |
| `src/app/(dashboard)/employees/[id]/edit/page.tsx` | Modify | "Termina rapporto" + "Riattiva" actions with ConfirmProvider dialog |
| `src/app/(dashboard)/employees/page.tsx` | Modify | "Cessato" badge + "Mostra cessati" toggle (default hidden) |

**Shared contracts (referenced by every later task — use these EXACT names/signatures):**

- `todayRome(date?: Date): string` from `@/lib/tz` converts a Prisma `DateTime` (JS `Date`) to `"YYYY-MM-DD"` in Europe/Rome. **Never** use `formatDateIsoIt` for these comparisons (it returns `"DD/MM/YYYY"` and breaks string ordering).
- `terminationDate` is stored at UTC midnight via `new Date("YYYY-MM-DD")` (identical to how `hireDate` is stored in employees `POST`/`PUT`). It is the **inclusive** last active day.
- `isActiveOn(emp, dateIso)` — active iff `(!hireDate || todayRome(hireDate) <= dateIso) && (!terminationDate || todayRome(terminationDate) >= dateIso)`. `dateIso` is `"YYYY-MM-DD"`.
- `activeOnWhere(dateIso): Prisma.EmployeeWhereInput`.
- `isTerminatedOnDate(termDate, dateIso)` — `termDate != null && todayRome(termDate) < dateIso` (i.e. NOT active because past the ceiling).

---

### Task 1: Schema — add termination fields + relation

**Files:**
- Modify: `prisma/schema.prisma` (`User` model lines ~10-26, `Employee` model lines ~28-49)
- Verify: `npm run build`

- [ ] **Step 1: Edit the `Employee` model** — add the four columns and the `terminatedBy` relation. Replace the closing block of the `Employee` model (the lines from `createdAt` through the closing `}`):

  Replace:
  ```prisma
  createdAt    DateTime           @default(now())
  records      AttendanceRecord[]
  employeeApiKey EmployeeApiKey?
  userAccount  User?              @relation("UserEmployee")
  anomalies    Anomaly[]
  schedule     EmployeeSchedule[]
  leaves       LeaveRequest[]
  balances     LeaveBalance[]
}
  ```
  With:
  ```prisma
  createdAt    DateTime           @default(now())
  terminationDate   DateTime?     // null = attivo; valorizzato = ultimo giorno lavorativo (incluso)
  terminationReason String?       // "RESIGNATION" | "DISMISSAL" | "OTHER" (+ nota libera opzionale)
  terminatedById    String?       // admin che ha eseguito la cessazione (audit)
  terminatedAt      DateTime?     // quando e' stata eseguita l'azione
  records      AttendanceRecord[]
  employeeApiKey EmployeeApiKey?
  userAccount  User?              @relation("UserEmployee")
  anomalies    Anomaly[]
  schedule     EmployeeSchedule[]
  leaves       LeaveRequest[]
  balances     LeaveBalance[]
  terminatedBy User?              @relation("EmployeeTerminatedBy", fields: [terminatedById], references: [id])
}
  ```

- [ ] **Step 2: Edit the `User` model** — add the back-relation. Replace:
  ```prisma
  payrollImports PayrollImport[] @relation("PayrollImports")
  employee       Employee?      @relation("UserEmployee", fields: [employeeId], references: [id])
}
  ```
  With:
  ```prisma
  payrollImports PayrollImport[] @relation("PayrollImports")
  employee       Employee?      @relation("UserEmployee", fields: [employeeId], references: [id])
  terminatedEmployees Employee[] @relation("EmployeeTerminatedBy")
}
  ```

- [ ] **Step 3: Push schema + regenerate client** (this repo has NO migrations dir — never run `prisma migrate`)
  - Run: `npm run db:push`
  - Run: `npm run db:generate`
  - Expected: both succeed; `@prisma/client` now types `Employee.terminationDate: Date | null`.

- [ ] **Step 4: Verify typecheck/build** (verification step in lieu of a unit test)
  - Run: `npm run build`
  - Expected: PASS (no type errors). The new fields exist on the generated `Employee` type.

- [ ] **Step 5: Commit**
  ```bash
  git add prisma/schema.prisma
  git commit -m "feat(employees): add termination fields to Employee schema (fine-rapporto task 1)"
  ```

---

### Task 2: Primitive `isActiveOn` + `activeOnWhere`

**Files:**
- Create: `src/lib/employees/active.ts`
- Test: `src/lib/employees/active.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/lib/employees/active.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { isActiveOn, activeOnWhere } from "./active";

  // Dates are stored at UTC midnight (new Date("YYYY-MM-DD")), same as hireDate.
  const d = (iso: string) => new Date(iso);

  describe("isActiveOn", () => {
    it("no hireDate, no terminationDate → always active", () => {
      expect(isActiveOn({ hireDate: null, terminationDate: null }, "2026-06-09")).toBe(true);
    });

    it("hired exactly on D → active (hire floor inclusive)", () => {
      expect(isActiveOn({ hireDate: d("2026-06-09"), terminationDate: null }, "2026-06-09")).toBe(true);
    });

    it("hired after D → inactive", () => {
      expect(isActiveOn({ hireDate: d("2026-06-10"), terminationDate: null }, "2026-06-09")).toBe(false);
    });

    it("hired before D → active", () => {
      expect(isActiveOn({ hireDate: d("2020-01-01"), terminationDate: null }, "2026-06-09")).toBe(true);
    });

    it("terminated exactly on D → active (termination ceiling inclusive)", () => {
      expect(isActiveOn({ hireDate: null, terminationDate: d("2026-06-09") }, "2026-06-09")).toBe(true);
    });

    it("terminated before D → inactive", () => {
      expect(isActiveOn({ hireDate: null, terminationDate: d("2026-06-08") }, "2026-06-09")).toBe(false);
    });

    it("terminated after D → active (history regression: a June leaver is active in May)", () => {
      expect(isActiveOn({ hireDate: null, terminationDate: d("2026-06-30") }, "2026-05-15")).toBe(true);
    });

    it("hired before D and terminated after D → active", () => {
      expect(isActiveOn({ hireDate: d("2024-01-01"), terminationDate: d("2026-12-31") }, "2026-06-09")).toBe(true);
    });

    it("D before hire AND after termination is impossible; D inside [hire, term] is active", () => {
      const emp = { hireDate: d("2026-06-01"), terminationDate: d("2026-06-30") };
      expect(isActiveOn(emp, "2026-05-31")).toBe(false); // before hire
      expect(isActiveOn(emp, "2026-07-01")).toBe(false); // after termination
      expect(isActiveOn(emp, "2026-06-15")).toBe(true);  // inside window
    });
  });

  describe("activeOnWhere", () => {
    it("builds an AND of two OR groups around the date", () => {
      const w = activeOnWhere("2026-06-09");
      expect(w).toEqual({
        AND: [
          { OR: [{ hireDate: null }, { hireDate: { lte: new Date("2026-06-09T23:59:59.999Z") } }] },
          { OR: [{ terminationDate: null }, { terminationDate: { gte: new Date("2026-06-09T00:00:00.000Z") } }] },
        ],
      });
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  - Run: `npx vitest run src/lib/employees/active.test.ts`
  - Expected: FAIL — cannot find module `./active` (file does not exist yet).

- [ ] **Step 3: Implement** — create `src/lib/employees/active.ts`:
  ```ts
  import type { Prisma } from "@prisma/client";
  import { todayRome } from "@/lib/tz";

  /**
   * Inclusive of both endpoints: active on day D iff hired on/before D and
   * not terminated before D. `dateIso` is "YYYY-MM-DD".
   *
   * terminationDate is the employee's INCLUSIVE last active day:
   * active on D iff D <= terminationDate.
   */
  export function isActiveOn(
    emp: { hireDate: Date | null; terminationDate: Date | null },
    dateIso: string,
  ): boolean {
    if (emp.hireDate && todayRome(emp.hireDate) > dateIso) return false;
    if (emp.terminationDate && todayRome(emp.terminationDate) < dateIso) return false;
    return true;
  }

  /**
   * Prisma where-fragment for list endpoints (D = today or period-end).
   * Filters relative to the period date D — never a global
   * `{ terminationDate: null }` (which would break historical reports).
   */
  export function activeOnWhere(dateIso: string): Prisma.EmployeeWhereInput {
    return {
      AND: [
        { OR: [{ hireDate: null }, { hireDate: { lte: new Date(`${dateIso}T23:59:59.999Z`) } }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gte: new Date(`${dateIso}T00:00:00.000Z`) } }] },
      ],
    };
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run src/lib/employees/active.test.ts`
  - Expected: PASS (all `isActiveOn` + `activeOnWhere` cases green).

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/employees/active.ts src/lib/employees/active.test.ts
  git commit -m "feat(employees): isActiveOn + activeOnWhere primitive (fine-rapporto task 2)"
  ```

---

### Task 3: Accrual cap in `computeLeaveBalanceFromData`

**Files:**
- Modify: `src/lib/leaves/balance.ts` (`EmployeeForBalance` ~113-118, `computeLeaveBalanceFromData` accrual block ~154-178, wrapper call site ~284-294)
- Modify: `src/app/api/stats/dashboard/route.ts` (`allEmployees` select ~87, `computeLeaveBalanceFromData` call ~416-426) — see Task 5b for the rest of this file's edits; the `terminationDate` plumbing happens here
- Test: `src/lib/leaves/balance.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `src/lib/leaves/balance.test.ts`, inside the existing `describe("computeLeaveBalanceFromData", () => { ... })` block, just before its closing `});`:
  ```ts
    it("terminated in this year (Aug) → accrual capped at termination month inclusive (8 months)", () => {
      const r = computeLeaveBalanceFromData(
        { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
        null,
        [],
        2026,
        new Date("2026-12-31T12:00:00Z"),
      );
      // Jan..Aug = 8 months × 2 days = 16
      expect(r.vacationAccrued).toBe(16);
      expect(r.rolAccrued).toBe(16);
    });

    it("year after termination → 0 months accrued", () => {
      const r = computeLeaveBalanceFromData(
        { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
        null,
        [],
        2027,
        new Date("2027-12-31T12:00:00Z"),
      );
      expect(r.vacationAccrued).toBe(0);
      expect(r.rolAccrued).toBe(0);
    });

    it("year before termination → unchanged (full 12 months)", () => {
      const r = computeLeaveBalanceFromData(
        { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
        null,
        [],
        2025,
        new Date("2026-12-31T12:00:00Z"),
      );
      expect(r.vacationAccrued).toBe(24);
      expect(r.rolAccrued).toBe(24);
    });

    it("part-time terminated mid-year → cap AND proportion both apply", () => {
      // PART_TIME 24h/wk, terminated Aug 2026 → 8 months × (24/40 × 2 days) = 8 × 1.2 = 9.6
      const r = computeLeaveBalanceFromData(
        { id: "e2", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "PART_TIME", schedule: partTimeSchedule24h() },
        null,
        [],
        2026,
        new Date("2026-12-31T12:00:00Z"),
      );
      expect(r.weeklyHours).toBe(24);
      expect(r.vacationAccrued).toBeCloseTo(9.6, 2);
      expect(r.rolAccrued).toBeCloseTo(9.6, 2);
    });

    it("hired June, terminated August same year → 3 months (Jun,Jul,Aug)", () => {
      const r = computeLeaveBalanceFromData(
        { id: "e1", hireDate: new Date("2026-06-15"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
        null,
        [],
        2026,
        new Date("2026-12-31T12:00:00Z"),
      );
      // Jun..Aug = 3 months × 2 = 6
      expect(r.vacationAccrued).toBe(6);
      expect(r.rolAccrued).toBe(6);
    });

    it("adjust fields still added on top of capped accrual", () => {
      const r = computeLeaveBalanceFromData(
        { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
        { vacationCarryOver: 0, rolCarryOver: 0, vacationAccrualAdjust: 2, rolAccrualAdjust: 1 },
        [],
        2026,
        new Date("2026-12-31T12:00:00Z"),
      );
      // 16 accrued + 2 adjust − 0 used = 18 remaining
      expect(r.vacationAccrued).toBe(16);
      expect(r.vacationRemaining).toBe(18);
    });
  ```
  Note: the `partTimeSchedule24h` and `fullTimeSchedule` helpers already exist at the top of this test file.

- [ ] **Step 2: Run tests to verify they fail**
  - Run: `npx vitest run src/lib/leaves/balance.test.ts`
  - Expected: FAIL — TypeScript error `terminationDate` is not assignable to `EmployeeForBalance`; and the new accrual assertions fail (no cap applied yet).

- [ ] **Step 3a: Implement — add `terminationDate` to the interface** in `src/lib/leaves/balance.ts`. Replace:
  ```ts
  export interface EmployeeForBalance {
    id: string;
    hireDate: Date | null;
    contractType: string;
    schedule: Array<ScheduleBlock & { dayOfWeek: number }>;
  }
  ```
  With:
  ```ts
  export interface EmployeeForBalance {
    id: string;
    hireDate: Date | null;
    terminationDate: Date | null;
    contractType: string;
    schedule: Array<ScheduleBlock & { dayOfWeek: number }>;
  }
  ```

- [ ] **Step 3b: Implement — apply the termination ceiling** in `computeLeaveBalanceFromData`, AFTER the existing hire-based branches and BEFORE the existing clamp. Replace:
  ```ts
    monthsAccrued = Math.max(0, Math.min(12, monthsAccrued));
  ```
  With:
  ```ts
    // ── Termination ceiling (cap upper month at termination month, inclusive) ──
    // Uses the SAME local-Date convention as hireDate above
    // (new Date(...).getFullYear()/getMonth()).
    if (employee.terminationDate) {
      const term = new Date(employee.terminationDate);
      const termYear = term.getFullYear();
      const termMonth = term.getMonth();
      if (termYear < year) {
        monthsAccrued = 0;
      } else if (termYear === year) {
        // effectiveEndMonth = the last month currently counted for this year:
        // currentMonth if computing the running year, else December (11).
        const effectiveEndMonth = year === currentYear ? currentMonth : 11;
        if (termMonth < effectiveEndMonth) {
          monthsAccrued -= effectiveEndMonth - termMonth;
        }
      }
    }

    monthsAccrued = Math.max(0, Math.min(12, monthsAccrued));
  ```

- [ ] **Step 3c: Implement — pass `terminationDate` at the wrapper call site** in `computeLeaveBalance` (this file, ~284-294). Replace:
  ```ts
    return computeLeaveBalanceFromData(
      {
        id: employee.id,
        hireDate: employee.hireDate,
        contractType: employee.contractType,
        schedule: employee.schedule,
      },
  ```
  With:
  ```ts
    return computeLeaveBalanceFromData(
      {
        id: employee.id,
        hireDate: employee.hireDate,
        terminationDate: employee.terminationDate,
        contractType: employee.contractType,
        schedule: employee.schedule,
      },
  ```

- [ ] **Step 3d: Implement — dashboard call site** in `src/app/api/stats/dashboard/route.ts`. First add `terminationDate` to the `allEmployees` select (line ~87). Replace:
  ```ts
      select: { id: true, name: true, displayName: true, avatarUrl: true, contractType: true, hireDate: true },
  ```
  With:
  ```ts
      select: { id: true, name: true, displayName: true, avatarUrl: true, contractType: true, hireDate: true, terminationDate: true },
  ```
  Then pass it into the per-employee `computeLeaveBalanceFromData` call (line ~416-426). Replace:
  ```ts
        const bal = computeLeaveBalanceFromData(
          {
            id: emp.id,
            hireDate: emp.hireDate,
            contractType: emp.contractType,
            schedule: scheduleRowsByEmp.get(emp.id) ?? [],
          },
  ```
  With:
  ```ts
        const bal = computeLeaveBalanceFromData(
          {
            id: emp.id,
            hireDate: emp.hireDate,
            terminationDate: emp.terminationDate,
            contractType: emp.contractType,
            schedule: scheduleRowsByEmp.get(emp.id) ?? [],
          },
  ```

- [ ] **Step 4: Run tests to verify they pass**
  - Run: `npx vitest run src/lib/leaves/balance.test.ts`
  - Expected: PASS (all existing + new accrual-cap tests green).
  - Run: `npm run build`
  - Expected: PASS (dashboard + wrapper call sites typecheck with the new required field).

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/leaves/balance.ts src/lib/leaves/balance.test.ts src/app/api/stats/dashboard/route.ts
  git commit -m "feat(leaves): cap accrual at termination month + plumb terminationDate (fine-rapporto task 3)"
  ```

---

### Task 4: Termination domain logic + route

**Files:**
- Create: `src/lib/employees/termination.ts`
- Test: `src/lib/employees/termination.test.ts`
- Create: `src/app/api/employees/[id]/termination/route.ts` (thin wrapper — manual verification)

- [ ] **Step 1: Write the failing test** — create `src/lib/employees/termination.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { planTermination, isTerminatedOnDate } from "./termination";

  const baseEmp = {
    id: "e1",
    hireDate: new Date("2024-01-01"),
    nfcUid: "04A1B2C3",
    telegramChatId: "123456789",
  };

  describe("planTermination", () => {
    it("builds updateData nulling nfcUid + telegramChatId and setting the 4 fields", () => {
      const { updateData } = planTermination(
        baseEmp,
        { terminationDate: "2026-06-09", reason: "RESIGNATION" },
        "admin-1",
        new Date("2026-06-09T10:00:00Z"),
      );
      expect(updateData.nfcUid).toBeNull();
      expect(updateData.telegramChatId).toBeNull();
      expect(updateData.terminationDate).toEqual(new Date("2026-06-09"));
      expect(updateData.terminationReason).toBe("RESIGNATION");
      expect(updateData.terminatedById).toBe("admin-1");
      expect(updateData.terminatedAt).toEqual(new Date("2026-06-09T10:00:00Z"));
    });

    it("appends a free-text note to the reason when provided", () => {
      const { updateData } = planTermination(
        baseEmp,
        { terminationDate: "2026-06-09", reason: "OTHER", note: "trasferimento sede" },
        "admin-1",
        new Date("2026-06-09T10:00:00Z"),
      );
      expect(updateData.terminationReason).toBe("OTHER: trasferimento sede");
    });

    it("throws when terminationDate is before hireDate", () => {
      expect(() =>
        planTermination(
          baseEmp,
          { terminationDate: "2023-12-31", reason: "DISMISSAL" },
          "admin-1",
          new Date("2026-06-09T10:00:00Z"),
        ),
      ).toThrow(/hireDate|assunzione/i);
    });

    it("throws on malformed terminationDate", () => {
      expect(() =>
        planTermination(baseEmp, { terminationDate: "09/06/2026", reason: "OTHER" }, "admin-1", new Date()),
      ).toThrow(/YYYY-MM-DD|formato/i);
    });

    it("throws on invalid reason", () => {
      expect(() =>
        // @ts-expect-error invalid reason on purpose
        planTermination(baseEmp, { terminationDate: "2026-06-09", reason: "FIRED" }, "admin-1", new Date()),
      ).toThrow(/reason|motivo/i);
    });

    it("warns when approved/pending leaves exist beyond terminationDate", () => {
      const { warnings } = planTermination(
        baseEmp,
        { terminationDate: "2026-06-09", reason: "RESIGNATION" },
        "admin-1",
        new Date("2026-06-09T10:00:00Z"),
        [{ status: "APPROVED", startDate: "2026-06-20", endDate: "2026-06-22" }],
      );
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toMatch(/2026-06-20/);
    });

    it("no warning when all leaves end on/before terminationDate", () => {
      const { warnings } = planTermination(
        baseEmp,
        { terminationDate: "2026-06-09", reason: "RESIGNATION" },
        "admin-1",
        new Date("2026-06-09T10:00:00Z"),
        [{ status: "APPROVED", startDate: "2026-06-01", endDate: "2026-06-05" }],
      );
      expect(warnings.length).toBe(0);
    });

    it("ignores hireDate check when employee has no hireDate", () => {
      const { updateData } = planTermination(
        { id: "e2", hireDate: null, nfcUid: null, telegramChatId: null },
        { terminationDate: "2026-06-09", reason: "OTHER" },
        "admin-1",
        new Date("2026-06-09T10:00:00Z"),
      );
      expect(updateData.terminationDate).toEqual(new Date("2026-06-09"));
    });
  });

  describe("isTerminatedOnDate", () => {
    it("null termDate → never terminated", () => {
      expect(isTerminatedOnDate(null, "2026-06-09")).toBe(false);
    });
    it("date after termination → terminated", () => {
      expect(isTerminatedOnDate(new Date("2026-06-09"), "2026-06-10")).toBe(true);
    });
    it("date equal to termination → NOT terminated (inclusive last day)", () => {
      expect(isTerminatedOnDate(new Date("2026-06-09"), "2026-06-09")).toBe(false);
    });
    it("date before termination → NOT terminated", () => {
      expect(isTerminatedOnDate(new Date("2026-06-09"), "2026-06-08")).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  - Run: `npx vitest run src/lib/employees/termination.test.ts`
  - Expected: FAIL — cannot find module `./termination`.

- [ ] **Step 3a: Implement** — create `src/lib/employees/termination.ts`:
  ```ts
  import { todayRome } from "@/lib/tz";

  export const TERMINATION_REASONS = ["RESIGNATION", "DISMISSAL", "OTHER"] as const;
  export type TerminationReason = (typeof TERMINATION_REASONS)[number];

  export interface TerminationInput {
    terminationDate: string; // "YYYY-MM-DD"
    reason: TerminationReason;
    note?: string;
  }

  export interface EmployeeForTermination {
    id: string;
    hireDate: Date | null;
    nfcUid: string | null;
    telegramChatId: string | null;
  }

  export interface TerminationLeaveRow {
    status: string;
    startDate: string; // "YYYY-MM-DD"
    endDate: string;   // "YYYY-MM-DD"
  }

  export interface TerminationUpdateData {
    terminationDate: Date;
    terminationReason: string;
    terminatedById: string;
    terminatedAt: Date;
    nfcUid: null;
    telegramChatId: null;
  }

  export interface TerminationPlan {
    updateData: TerminationUpdateData;
    warnings: string[];
  }

  /**
   * Pure: validate + build the Prisma update payload for terminating an
   * employee. Frees nfcUid + telegramChatId for reuse. Throws on invalid
   * input (bad date format, reason, or terminationDate < hireDate).
   */
  export function planTermination(
    employee: EmployeeForTermination,
    input: TerminationInput,
    actorUserId: string,
    now: Date = new Date(),
    leaves: TerminationLeaveRow[] = [],
  ): TerminationPlan {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.terminationDate)) {
      throw new Error("Formato terminationDate non valido (YYYY-MM-DD)");
    }
    if (!TERMINATION_REASONS.includes(input.reason)) {
      throw new Error("Motivo (reason) non valido: usa RESIGNATION, DISMISSAL o OTHER");
    }
    if (employee.hireDate && todayRome(employee.hireDate) > input.terminationDate) {
      throw new Error("terminationDate non puo' precedere la data di assunzione (hireDate)");
    }

    const reason = input.note?.trim()
      ? `${input.reason}: ${input.note.trim()}`
      : input.reason;

    const warnings: string[] = [];
    for (const l of leaves) {
      if ((l.status === "APPROVED" || l.status === "PENDING") && l.endDate > input.terminationDate) {
        warnings.push(
          `Richiesta ${l.status} dal ${l.startDate} al ${l.endDate} oltre la data di cessazione (${input.terminationDate})`,
        );
      }
    }

    return {
      updateData: {
        terminationDate: new Date(input.terminationDate),
        terminationReason: reason,
        terminatedById: actorUserId,
        terminatedAt: now,
        nfcUid: null,
        telegramChatId: null,
      },
      warnings,
    };
  }

  /**
   * True iff the employee is terminated as-of `dateIso` (strictly past the
   * inclusive last active day). Mirror of !isActiveOn for the term ceiling.
   */
  export function isTerminatedOnDate(termDate: Date | null, dateIso: string): boolean {
    if (!termDate) return false;
    return todayRome(termDate) < dateIso;
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run src/lib/employees/termination.test.ts`
  - Expected: PASS (all `planTermination` + `isTerminatedOnDate` cases green).

- [ ] **Step 5: Commit the pure logic**
  ```bash
  git add src/lib/employees/termination.ts src/lib/employees/termination.test.ts
  git commit -m "feat(employees): planTermination pure domain logic + isTerminatedOnDate (fine-rapporto task 4a)"
  ```

- [ ] **Step 6: Implement the route (thin wrapper)** — create `src/app/api/employees/[id]/termination/route.ts`:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { Prisma } from "@prisma/client";
  import { prisma } from "@/lib/db";
  import { auth } from "@/lib/auth";
  import { checkAuth } from "@/lib/auth-guard";
  import { planTermination, type TerminationReason } from "@/lib/employees/termination";

  /**
   * POST /api/employees/[id]/termination — termina (soft) un dipendente.
   * Body JSON: { terminationDate: "YYYY-MM-DD", reason: "RESIGNATION"|"DISMISSAL"|"OTHER", note?: string }
   * Libera nfcUid + telegramChatId, scrive i 4 campi di cessazione.
   *
   * DELETE /api/employees/[id]/termination — riattiva (annulla la cessazione).
   * La tessera/chat liberate vanno riassegnate manualmente.
   */
  export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const denied = await checkAuth();
    if (denied) return denied;

    const { id } = await params;
    const session = await auth();
    const actorUserId = session?.user?.id;
    if (!actorUserId) {
      return NextResponse.json({ error: "Sessione non valida" }, { status: 401 });
    }

    let body: { terminationDate?: unknown; reason?: unknown; note?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }

    const employee = await prisma.employee.findUnique({
      where: { id },
      select: { id: true, hireDate: true, nfcUid: true, telegramChatId: true },
    });
    if (!employee) {
      return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
    }

    const leaves = await prisma.leaveRequest.findMany({
      where: { employeeId: id, status: { in: ["APPROVED", "PENDING"] } },
      select: { status: true, startDate: true, endDate: true },
    });

    let plan;
    try {
      plan = planTermination(
        employee,
        {
          terminationDate: String(body.terminationDate ?? ""),
          reason: body.reason as TerminationReason,
          note: typeof body.note === "string" ? body.note : undefined,
        },
        actorUserId,
        new Date(),
        leaves,
      );
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Dati non validi" }, { status: 400 });
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: plan.updateData,
      select: { id: true, terminationDate: true, terminationReason: true },
    });

    return NextResponse.json({
      ok: true,
      id: updated.id,
      terminationDate: updated.terminationDate,
      terminationReason: updated.terminationReason,
      warnings: plan.warnings,
    });
  }

  export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const denied = await checkAuth();
    if (denied) return denied;

    const { id } = await params;
    const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true } });
    if (!employee) {
      return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
    }

    await prisma.employee.update({
      where: { id },
      data: {
        terminationDate: null,
        terminationReason: null,
        terminatedById: null,
        terminatedAt: null,
      } satisfies Prisma.EmployeeUpdateInput,
    });

    return NextResponse.json({ ok: true });
  }
  ```

- [ ] **Step 7: Manual verification** (no test-DB harness — verify via build + curl)
  - Run: `npm run build`
  - Expected: PASS.
  - Manual check (dev server running, admin session cookie): terminate
    ```bash
    curl -X POST http://localhost:3000/api/employees/<EMP_ID>/termination \
      -H "Content-Type: application/json" \
      -b "<admin-session-cookie>" \
      -d '{"terminationDate":"2026-06-09","reason":"RESIGNATION"}'
    ```
    Expect `{ ok: true, terminationDate: ..., warnings: [...] }`; verify in DB that `nfcUid`/`telegramChatId` are now `null` and the 4 fields are set. Reactivate with `DELETE` to the same URL and confirm the 4 fields are cleared.

- [ ] **Step 8: Commit the route**
  ```bash
  git add src/app/api/employees/[id]/termination/route.ts
  git commit -m "feat(employees): POST/DELETE termination route over planTermination (fine-rapporto task 4b)"
  ```

---

### Task 5a: Choke point — `buildPresenzeMonthData`

**Files:**
- Modify: `src/lib/excel-presenze.ts` (`buildPresenzeMonthData` employee query ~388-391)

- [ ] **Step 1: No new unit test** — the filter is a Prisma `where`; this file has no test harness and the pure decision is already covered by Task 2's `activeOnWhere` tests. Verification = build + Task 5b's `isActiveOn` reuse.

- [ ] **Step 2: Implement** — add the import and apply `activeOnWhere(to)` (`to` is already the month-end `"YYYY-MM-DD"` computed at lines ~384-385). At the top of `src/lib/excel-presenze.ts`, add the import next to the other `@/lib` imports:
  ```ts
  import { activeOnWhere } from "@/lib/employees/active";
  ```
  Then replace the employee query (lines ~388-391):
  ```ts
  const employees = await prisma.employee.findMany({
    select: { id: true, name: true, displayName: true, contractType: true },
    orderBy: { name: "asc" },
  });
  ```
  With:
  ```ts
  const employees = await prisma.employee.findMany({
    where: activeOnWhere(to), // attivi nel mese: esclude chi e' cessato prima del mese
    select: { id: true, name: true, displayName: true, contractType: true },
    orderBy: { name: "asc" },
  });
  ```

- [ ] **Step 3: Verify**
  - Run: `npm run build`
  - Expected: PASS.

- [ ] **Step 4: Commit**
  ```bash
  git add src/lib/excel-presenze.ts
  git commit -m "feat(report): exclude employees terminated before the month from presenze (fine-rapporto task 5a)"
  ```

---

### Task 5b: Choke point — dashboard live counts + `computeOreChart`

**Files:**
- Modify: `src/app/api/stats/dashboard/route.ts` (`totalEmployees` ~205, `employeesToday` ~306, `computeOreChart` signature ~643-649 + per-month loop ~681-713). The `allEmployees` select already gained `terminationDate` in Task 3 Step 3d.

- [ ] **Step 1: No new automated test** — route hits Prisma; the per-month decision reuses the tested `isActiveOn`. Verification = build + manual dashboard check.

- [ ] **Step 2a: Implement — import + a derived `activeEmployees` for today.** Add the import at the top of `src/app/api/stats/dashboard/route.ts` (next to the other `@/lib` imports):
  ```ts
  import { isActiveOn } from "@/lib/employees/active";
  ```
  Immediately after `const totalEmployees = allEmployees.length;` (line ~205), DO NOT change that line yet — instead define a today-active subset just below it and use it for live counts. Replace:
  ```ts
  const totalEmployees = allEmployees.length;
  ```
  With:
  ```ts
  // Dipendenti attivi OGGI (per conteggi live; lo storico usa isActiveOn per-periodo).
  const activeTodayEmployees = allEmployees.filter((e) => isActiveOn(e, today));
  const totalEmployees = activeTodayEmployees.length;
  ```

- [ ] **Step 2b: Implement — drive `employeesToday` from the active subset.** Replace (line ~306):
  ```ts
  const employeesToday: EmployeeTodayStatus[] = allEmployees.map((emp) => {
  ```
  With:
  ```ts
  const employeesToday: EmployeeTodayStatus[] = activeTodayEmployees.map((emp) => {
  ```

- [ ] **Step 2c: Implement — `computeOreChart` per-month termination awareness.** Change the `allEmployees` param type so it carries the date fields, then filter per month. Replace the signature (lines ~643-649):
  ```ts
  async function computeOreChart(
    months: number,
    scheduleMap: Map<string, Map<number, EmployeeScheduleDay>>,
    allEmployees: { id: string; contractType: string }[],
    dismissedSet: Set<string>,
    filterEmployeeId?: string | null,
  ): Promise<OreChartPoint[]> {
  ```
  With:
  ```ts
  async function computeOreChart(
    months: number,
    scheduleMap: Map<string, Map<number, EmployeeScheduleDay>>,
    allEmployees: { id: string; contractType: string; hireDate: Date | null; terminationDate: Date | null }[],
    dismissedSet: Set<string>,
    filterEmployeeId?: string | null,
  ): Promise<OreChartPoint[]> {
  ```
  Then, inside the monthly loop, restrict the contracted-hours denominator to employees active at month-end. Replace (lines ~688-690):
  ```ts
      // Ore contratto: somma delle ore giornaliere di ogni dipendente per i giorni lavorativi del mese
      let contratto = 0;
      for (const emp of allEmployees) {
  ```
  With:
  ```ts
      // Ore contratto: somma delle ore giornaliere di ogni dipendente per i giorni lavorativi del mese.
      // Esclude chi non e' attivo a fine mese (assunto dopo / cessato prima) cosi' i mesi
      // post-cessazione non gonfiano il denominatore delle ore contratto.
      const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      let contratto = 0;
      for (const emp of allEmployees) {
        if (!isActiveOn(emp, monthEnd)) continue;
  ```

- [ ] **Step 3: Verify**
  - Run: `npm run build`
  - Expected: PASS — the `computeOreChart` call site already passes `allEmployees` objects that now include `hireDate` + `terminationDate` (from the Task 3 select).
  - Manual check: terminate an employee with `terminationDate` in a prior month; reload the dashboard. The employee disappears from `totalEmployees`/`employeesToday` and from the contracted-hours denominator for months after termination, but the months before termination are unchanged.

- [ ] **Step 4: Commit**
  ```bash
  git add src/app/api/stats/dashboard/route.ts
  git commit -m "feat(dashboard): filter live counts + ore chart by isActiveOn (fine-rapporto task 5b)"
  ```

---

### Task 5c: Choke point — leave dropdowns + payroll picker

**Files:**
- Modify: `src/app/api/leaves/by-employee/route.ts` (employee query ~26-28)
- Modify: `src/app/api/settings/users/route.ts` (employee dropdown query ~43-46)
- Modify: `src/app/api/employees/route.ts` (`withoutPayrollId` picker ~13-17; main `GET` returns `terminationDate`)

- [ ] **Step 1: No new automated test** — Prisma `where`; covered by Task 2's `activeOnWhere` tests.

- [ ] **Step 2a: Implement — `leaves/by-employee`.** Add the import at the top of `src/app/api/leaves/by-employee/route.ts`:
  ```ts
  import { activeOnWhere } from "@/lib/employees/active";
  import { todayRome } from "@/lib/tz";
  ```
  Replace (lines ~26-28):
  ```ts
  const employees = await prisma.employee.findMany({
    orderBy: { name: "asc" },
  });
  ```
  With:
  ```ts
  const employees = await prisma.employee.findMany({
    where: activeOnWhere(todayRome()),
    orderBy: { name: "asc" },
  });
  ```

- [ ] **Step 2b: Implement — settings/users dropdown.** Add the import at the top of `src/app/api/settings/users/route.ts`:
  ```ts
  import { activeOnWhere } from "@/lib/employees/active";
  import { todayRome } from "@/lib/tz";
  ```
  Replace (lines ~43-46):
  ```ts
  const employees = await prisma.employee.findMany({
    select: { id: true, name: true, displayName: true, email: true },
    orderBy: { name: "asc" },
  });
  ```
  With:
  ```ts
  const employees = await prisma.employee.findMany({
    where: activeOnWhere(todayRome()),
    select: { id: true, name: true, displayName: true, email: true },
    orderBy: { name: "asc" },
  });
  ```

- [ ] **Step 2c: Implement — `withoutPayrollId` picker.** In `src/app/api/employees/route.ts`, add the import (next to the existing `todayRome` import):
  ```ts
  import { activeOnWhere } from "@/lib/employees/active";
  ```
  Replace (lines ~13-17):
  ```ts
    const list = await prisma.employee.findMany({
      where: { payrollId: null },
      select: { id: true, name: true, displayName: true },
      orderBy: { name: "asc" },
    });
  ```
  With:
  ```ts
    const list = await prisma.employee.findMany({
      where: { AND: [{ payrollId: null }, activeOnWhere(todayRome())] },
      select: { id: true, name: true, displayName: true },
      orderBy: { name: "asc" },
    });
  ```

- [ ] **Step 2d: Implement — main `GET` returns `terminationDate`** (do NOT hard-exclude; UI hides them). In `src/app/api/employees/route.ts`, the main list query uses `include: { records: ... }` which already returns every scalar. Add `terminationDate` to the mapped result object. Replace (lines ~33-45 — the returned object):
  ```ts
      return {
        id: emp.id,
        name: emp.name,
        displayName: emp.displayName,
        avatarUrl: emp.avatarUrl,
        aliases: JSON.parse(emp.aliases) as string[],
        nfcUid: emp.nfcUid,
        telegramChatId: emp.telegramChatId,
        telegramUsername: emp.telegramUsername,
        email: emp.email,
        totalDays,
        lastSeen: emp.records[0]?.date || null,
      };
  ```
  With:
  ```ts
      return {
        id: emp.id,
        name: emp.name,
        displayName: emp.displayName,
        avatarUrl: emp.avatarUrl,
        aliases: JSON.parse(emp.aliases) as string[],
        nfcUid: emp.nfcUid,
        telegramChatId: emp.telegramChatId,
        telegramUsername: emp.telegramUsername,
        email: emp.email,
        totalDays,
        lastSeen: emp.records[0]?.date || null,
        terminationDate: emp.terminationDate ? todayRome(emp.terminationDate) : null,
      };
  ```

- [ ] **Step 3: Verify**
  - Run: `npm run build`
  - Expected: PASS.
  - Manual check: a terminated employee no longer appears in the `/leaves` "per dipendente" view, the user-association dropdown, or the payroll picker; the main `/api/employees` list still returns them with a `terminationDate`.

- [ ] **Step 4: Commit**
  ```bash
  git add src/app/api/leaves/by-employee/route.ts src/app/api/settings/users/route.ts src/app/api/employees/route.ts
  git commit -m "feat(employees): filter dropdowns by activeOnWhere + expose terminationDate in list (fine-rapporto task 5c)"
  ```

---

### Task 6: anomaly-sync suppression

**Files:**
- Modify: `src/lib/anomaly-sync.ts`
- Test: `src/lib/anomaly-sync.test.ts` (Create — pure helper only)

- [ ] **Step 1: Write the failing test** — create `src/lib/anomaly-sync.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { shouldSuppressAnomaly } from "./anomaly-sync";

  describe("shouldSuppressAnomaly", () => {
    it("no termination → never suppress", () => {
      expect(shouldSuppressAnomaly(null, "2026-06-09")).toBe(false);
    });
    it("date after termination → suppress (no anomaly for post-termination days)", () => {
      expect(shouldSuppressAnomaly(new Date("2026-06-09"), "2026-06-10")).toBe(true);
    });
    it("date equal to termination → do NOT suppress (inclusive last day)", () => {
      expect(shouldSuppressAnomaly(new Date("2026-06-09"), "2026-06-09")).toBe(false);
    });
    it("date before termination → do NOT suppress", () => {
      expect(shouldSuppressAnomaly(new Date("2026-06-09"), "2026-05-01")).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  - Run: `npx vitest run src/lib/anomaly-sync.test.ts`
  - Expected: FAIL — `shouldSuppressAnomaly` is not exported.

- [ ] **Step 3a: Implement — export the pure helper.** In `src/lib/anomaly-sync.ts`, add the import at the top and the helper near `isFullDayLeave`:
  ```ts
  import { prisma } from "./db";
  import type { DailyStats } from "./calculator";
  import { getLeaveForDate } from "./leaves";
  import { todayRome } from "./tz";
  ```
  After `isFullDayLeave` (before `syncAnomalies`), add:
  ```ts
  /**
   * Pure: suppress new anomalies (and stale-cleanup) for days strictly after
   * the employee's inclusive termination date. termDate at UTC midnight.
   */
  export function shouldSuppressAnomaly(termDate: Date | null, date: string): boolean {
    if (!termDate) return false;
    return date > todayRome(termDate);
  }
  ```

- [ ] **Step 3b: Implement — batch-load terminations + guard.** Inside `syncAnomalies`, build the termination map once at the top and add the guard ABOVE `processedKeys.add` so terminated days are NOT swept by stale-cleanup. Replace:
  ```ts
    let created = 0;

    // Collect all employee+date combos we're processing
    const processedKeys = new Set<string>();

    for (const ds of dailyStats) {
      processedKeys.add(`${ds.employeeId}|${ds.date}`);

      // Skip anomaly creation if date is fully covered by approved leave
      const fullLeave = await isFullDayLeave(ds.employeeId, ds.date);
      if (fullLeave) continue;
  ```
  With:
  ```ts
    let created = 0;

    // Batch-load termination dates once for all employees we're processing.
    const empIds = [...new Set(dailyStats.map((s) => s.employeeId))];
    const terminatedRows = await prisma.employee.findMany({
      where: { id: { in: empIds }, terminationDate: { not: null } },
      select: { id: true, terminationDate: true },
    });
    const terminationByEmp = new Map<string, Date | null>(
      terminatedRows.map((e) => [e.id, e.terminationDate]),
    );

    // Collect all employee+date combos we're processing
    const processedKeys = new Set<string>();

    for (const ds of dailyStats) {
      // Skip post-termination days entirely: do NOT create anomalies and do
      // NOT add to processedKeys (so the stale-cleanup pass leaves them alone).
      if (shouldSuppressAnomaly(terminationByEmp.get(ds.employeeId) ?? null, ds.date)) {
        continue;
      }

      processedKeys.add(`${ds.employeeId}|${ds.date}`);

      // Skip anomaly creation if date is fully covered by approved leave
      const fullLeave = await isFullDayLeave(ds.employeeId, ds.date);
      if (fullLeave) continue;
  ```

- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run src/lib/anomaly-sync.test.ts`
  - Expected: PASS.
  - Run: `npm run build`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/anomaly-sync.ts src/lib/anomaly-sync.test.ts
  git commit -m "feat(anomalies): suppress anomalies for post-termination days (fine-rapporto task 6)"
  ```

---

### Task 7: Write guards (punches + leave creation + import)

**Files:**
- Test: `src/lib/employees/termination.test.ts` (already covers `isTerminatedOnDate` from Task 4 — no new test needed; routes are thin wrappers)
- Modify: `src/app/api/kiosk/punch/route.ts` (after employee non-null ~72, before record create ~120)
- Modify: `src/lib/telegram-handlers.ts` (`doPunch` ~130, after `date` computed)
- Modify: `src/app/api/import/upload/route.ts` (in the per-record loop ~58, compare `record.date`)
- Modify: `src/app/api/leaves/route.ts` (after employee fetch ~102)
- Modify: `src/app/api/external/leaves/route.ts` (after employee resolved ~68)

- [ ] **Step 1: Confirm the pure guard is already tested** — `isTerminatedOnDate` from `src/lib/employees/termination.ts` is covered by Task 4's tests. No new unit test; routes are thin wrappers verified by build + manual curl.
  - Run: `npx vitest run src/lib/employees/termination.test.ts`
  - Expected: PASS (already green).

- [ ] **Step 2a: Implement — kiosk punch guard.** In `src/app/api/kiosk/punch/route.ts`, add the import:
  ```ts
  import { isTerminatedOnDate } from "@/lib/employees/termination";
  ```
  The `date` is computed at line ~75 (`const date = todayRome(now);`). Immediately after that line, add the guard (the employee is already non-null here):
  ```ts
    // Guard: rifiuta timbrature per dipendenti cessati alla data odierna.
    if (isTerminatedOnDate(employee.terminationDate, date)) {
      return NextResponse.json(
        {
          status: "terminated",
          error: "Dipendente cessato: timbratura non consentita",
          employeeName: employee.displayName || employee.name,
        },
        { status: 403 },
      );
    }
  ```

- [ ] **Step 2b: Implement — telegram `doPunch` guard (punch-only).** In `src/lib/telegram-handlers.ts`, add the import near the other `./leaves` imports:
  ```ts
  import { isTerminatedOnDate } from "./employees/termination";
  ```
  In `doPunch`, after `const date = todayRome(now);` (line ~133), add:
  ```ts
    // Guard: i cessati non possono timbrare (i comandi di lettura ferie restano attivi).
    if (isTerminatedOnDate(employee.terminationDate, date)) {
      await reply(ctx.chatId, `⛔ Il tuo rapporto risulta cessato: la timbratura non e' consentita.`);
      return;
    }
  ```
  Note: this guard lives ONLY in `doPunch`, so `/storico`, `/assenze`, `/ferie`, `/permesso` read/list commands keep working. `employee` is `ctx.employee` (type `EmployeeRow`) which now carries `terminationDate` after the Task 1 regen.

- [ ] **Step 2c: Implement — import loop guard (compare record date, not today).** In `src/app/api/import/upload/route.ts`, add the import:
  ```ts
  import { isTerminatedOnDate } from "@/lib/employees/termination";
  ```
  In the per-record loop, after the find-or-create employee block (after line ~57, before the `try { ... attendanceRecord.create }`), add:
  ```ts
    // Guard: salta i record datati DOPO la cessazione del dipendente.
    // I record antecedenti la cessazione restano validi (storia preservata).
    if (isTerminatedOnDate(employee.terminationDate, record.date)) {
      skipped++;
      continue;
    }
  ```
  (The newly-created employee branch at line ~54 returns a row with `terminationDate: null`, so freshly-created employees are never skipped.)

- [ ] **Step 2d: Implement — leaves POST guard.** In `src/app/api/leaves/route.ts`, add the import:
  ```ts
  import { isTerminatedOnDate } from "@/lib/employees/termination";
  ```
  After the employee fetch + non-null check (after line ~102), add:
  ```ts
    // Guard: niente richieste che iniziano dopo la data di cessazione.
    if (isTerminatedOnDate(employee.terminationDate, body.startDate)) {
      return NextResponse.json(
        { error: "Dipendente cessato: impossibile creare richieste dopo la data di cessazione" },
        { status: 409 },
      );
    }
  ```

- [ ] **Step 2e: Implement — external/leaves POST guard.** In `src/app/api/external/leaves/route.ts`, add the import:
  ```ts
  import { isTerminatedOnDate } from "@/lib/employees/termination";
  ```
  After the resolved-employee non-null check (after line ~68, before the overlap detection at ~70), add:
  ```ts
    // Guard: niente richieste che iniziano dopo la data di cessazione.
    if (isTerminatedOnDate(employee.terminationDate, startDate)) {
      return NextResponse.json(
        { error: "Dipendente cessato: impossibile creare richieste dopo la data di cessazione" },
        { status: 409 },
      );
    }
  ```

- [ ] **Step 3: Verify**
  - Run: `npm run build`
  - Expected: PASS — all routes typecheck (`employee.terminationDate` exists after Task 1 regen).
  - Manual check (terminated employee, `terminationDate = 2026-06-09`):
    - NFC punch today (after the date) → `403 terminated`.
    - Telegram punch today → "rapporto cessato" reply; `/storico` still returns data.
    - `POST /api/leaves` with `startDate=2026-06-20` → `409`; with `startDate=2026-06-05` (back-dated, before termination) → accepted.
    - `POST /api/external/leaves` same behaviour.
    - Re-import a WhatsApp file containing a row dated `2026-06-20` for that employee → counted in `skipped`, not `imported`; a row dated `2026-06-05` → imported.

- [ ] **Step 4: Commit**
  ```bash
  git add src/app/api/kiosk/punch/route.ts src/lib/telegram-handlers.ts src/app/api/import/upload/route.ts src/app/api/leaves/route.ts src/app/api/external/leaves/route.ts
  git commit -m "feat(guards): reject post-termination punches/leaves/imports (fine-rapporto task 7)"
  ```

---

### Task 8: UI — terminate/reactivate + list toggle

**Files:**
- Modify: `src/app/(dashboard)/employees/[id]/edit/page.tsx` (`EmployeeProfile` interface ~15-32, load mapping ~152-166, new actions JSX)
- Modify: `src/app/(dashboard)/employees/page.tsx` (`Employee` interface ~13-21, toggle state, badge + actions JSX)

- [ ] **Step 1: No automated test** — client UI; verified manually (this repo has no component-test harness).

- [ ] **Step 2a: Implement — edit page: extend the profile type + state.** In `src/app/(dashboard)/employees/[id]/edit/page.tsx`, add to the `EmployeeProfile` interface (after `rolAccrualAdjust: number;`):
  ```ts
    terminationDate: string | null;
    terminationReason: string | null;
  ```
  Add state hooks next to the other `useState` declarations (after `const [rolAccrualAdjust, ...]`):
  ```ts
    const [terminationDate, setTerminationDate] = useState("");
    const [terminationReason, setTerminationReason] = useState<"RESIGNATION" | "DISMISSAL" | "OTHER">("RESIGNATION");
    const [terminationNote, setTerminationNote] = useState("");
    const [terminating, setTerminating] = useState(false);
  ```
  In the `useEffect` load mapping (after `if (data.avatarUrl) setPreview(data.avatarUrl);`), seed the date default:
  ```ts
        setTerminationDate(data.terminationDate ?? new Date().toISOString().slice(0, 10));
  ```

- [ ] **Step 2b: Implement — edit page: terminate/reactivate handlers.** Add these functions after `handleSave` (they reuse the existing `confirm` from `useConfirm()` and `toast`):
  ```ts
    const handleTerminate = async () => {
      const ok = await confirm({
        title: "Termina rapporto",
        message:
          "Il dipendente verra' marcato come cessato a partire dalla data scelta (ultimo giorno lavorativo incluso). " +
          "La tessera NFC e la chat Telegram verranno liberate per riuso. Lo storico resta intatto. Continuare?",
        confirmLabel: "Termina rapporto",
        danger: true,
      });
      if (!ok) return;
      setTerminating(true);
      try {
        const res = await fetch(`/api/employees/${id}/termination`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            terminationDate,
            reason: terminationReason,
            note: terminationNote.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          toast.success("Rapporto cessato");
          if (Array.isArray(data.warnings) && data.warnings.length > 0) {
            for (const w of data.warnings) toast.warning(w);
          }
          router.push("/employees");
        } else {
          toast.error(data.error || "Errore nella cessazione");
        }
      } finally {
        setTerminating(false);
      }
    };

    const handleReactivate = async () => {
      const ok = await confirm({
        title: "Riattiva dipendente",
        message:
          "Il rapporto verra' riattivato. Tessera NFC e chat Telegram, liberate alla cessazione, vanno riassegnate manualmente. Continuare?",
        confirmLabel: "Riattiva",
      });
      if (!ok) return;
      setTerminating(true);
      try {
        const res = await fetch(`/api/employees/${id}/termination`, { method: "DELETE" });
        if (res.ok) {
          toast.success("Dipendente riattivato");
          router.refresh();
          window.location.reload();
        } else {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error || "Errore nella riattivazione");
        }
      } finally {
        setTerminating(false);
      }
    };
  ```

- [ ] **Step 2c: Implement — edit page: the "Fine rapporto" section JSX.** Insert this block just before the closing `{/* Save */}` comment / `<div className="mt-6 flex items-center justify-between">` (line ~589):
  ```tsx
          {/* ── Fine rapporto ──────────────────────────────────────── */}
          <div className="border-t border-surface-container pt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-error">
              Fine rapporto
            </h3>
            {profile.terminationDate ? (
              <div className="space-y-3">
                <p className="text-sm text-on-surface-variant">
                  Cessato il <strong>{formatDateIsoIt(profile.terminationDate)}</strong>
                  {profile.terminationReason ? ` — ${profile.terminationReason}` : ""}.
                </p>
                <button
                  type="button"
                  onClick={handleReactivate}
                  disabled={terminating}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:bg-primary-container disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Riattiva
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="mb-1 text-xs text-outline-variant">
                  Marca il dipendente come cessato dalla data scelta. Lo storico resta intatto; tessera NFC e chat Telegram vengono liberate.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                      Data cessazione
                    </label>
                    <input
                      type="date"
                      value={terminationDate}
                      onChange={(e) => setTerminationDate(e.target.value)}
                      className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                      Motivo
                    </label>
                    <select
                      value={terminationReason}
                      onChange={(e) => setTerminationReason(e.target.value as "RESIGNATION" | "DISMISSAL" | "OTHER")}
                      className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0"
                    >
                      <option value="RESIGNATION">Dimissioni</option>
                      <option value="DISMISSAL">Licenziamento</option>
                      <option value="OTHER">Altro</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-on-surface-variant">
                    Nota (opzionale)
                  </label>
                  <input
                    type="text"
                    value={terminationNote}
                    onChange={(e) => setTerminationNote(e.target.value)}
                    placeholder="es. trasferimento sede"
                    className="w-full rounded-lg border-0 border-b-2 border-transparent bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:border-primary focus:ring-0"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleTerminate}
                  disabled={terminating}
                  className="rounded-md bg-error-container px-4 py-2 text-sm font-medium text-error hover:bg-error-container/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {terminating ? "Elaborazione..." : "Termina rapporto"}
                </button>
              </div>
            )}
          </div>
  ```
  (`formatDateIsoIt` is already imported at the top of this file.)

- [ ] **Step 2d: Implement — employees list: type + toggle + badge.** In `src/app/(dashboard)/employees/page.tsx`, add to the `Employee` interface (after `lastSeen: string | null;`):
  ```ts
    terminationDate: string | null;
  ```
  Add a toggle state next to `const [loading, setLoading] = useState(true);`:
  ```ts
    const [showTerminated, setShowTerminated] = useState(false);
  ```
  Derive the visible list — add just before the `return (` of `EmployeesPage`:
  ```ts
    const visibleEmployees = showTerminated
      ? employees
      : employees.filter((e) => !e.terminationDate);
  ```

- [ ] **Step 2e: Implement — list: render toggle + use `visibleEmployees` + badge.** Add the toggle control inside the header `<div className="flex items-start justify-between gap-4">`, right before the "Nuovo dipendente" button:
  ```tsx
        <label className="flex items-center gap-2 text-sm text-on-surface-variant">
          <input
            type="checkbox"
            checked={showTerminated}
            onChange={(e) => setShowTerminated(e.target.checked)}
            className="rounded border-outline-variant text-primary focus:ring-primary"
          />
          Mostra cessati
        </label>
  ```
  Change the table body map from `employees.map((emp) => (` to `visibleEmployees.map((emp) => (` (line ~196), and update the empty-state guard from `employees.length === 0` to `visibleEmployees.length === 0` (line ~174). Inside each row's name cell, after the `{emp.displayName && (...)}` block (line ~208), add the badge:
  ```tsx
                        {emp.terminationDate && (
                          <span className="mt-0.5 inline-block rounded bg-error-container px-1.5 py-0.5 text-[10px] font-medium text-error">
                            Cessato — {formatDate(emp.terminationDate)}
                          </span>
                        )}
  ```
  (`formatDate` is already imported at the top of this file.)

- [ ] **Step 3: Verify**
  - Run: `npm run build`
  - Expected: PASS.
  - Manual check:
    - On `/employees/<id>/edit`, an active employee shows the "Fine rapporto" form; submitting calls `POST /api/employees/<id>/termination`, surfaces any warnings as toasts, and redirects to `/employees`.
    - A terminated employee's edit page shows "Cessato il ..." + a "Riattiva" button that calls `DELETE`.
    - On `/employees`, terminated rows are hidden by default; ticking "Mostra cessati" reveals them with a red "Cessato — {date}" badge.

- [ ] **Step 4: Commit**
  ```bash
  git add "src/app/(dashboard)/employees/[id]/edit/page.tsx" "src/app/(dashboard)/employees/page.tsx"
  git commit -m "feat(ui): terminate/reactivate action + cessati toggle/badge (fine-rapporto task 8)"
  ```

---

## Self-Review

Spec coverage check against `2026-06-09-fine-rapporto-design.md`:

- **§5 Data model** — Task 1 adds `terminationDate`, `terminationReason`, `terminatedById`, `terminatedAt` + the `terminatedBy`/`terminatedEmployees` relation, via `db:push`/`db:generate` (no migrations). Re-hire clears all four fields (Task 4 `DELETE`).
- **§6.1 Primitive** — Task 2 implements `isActiveOn` + `activeOnWhere`. **Spec bug fixed:** the spec's `isActiveOn` snippet used `formatDateIsoIt` (returns `DD/MM/YYYY`, breaks ordering) and `new Date(\`${dateIso}T23:59:59\`)` (local TZ, ambiguous). This plan uses `todayRome` for the `YYYY-MM-DD` comparison and explicit UTC suffixes (`T23:59:59.999Z` / `T00:00:00.000Z`) in `activeOnWhere` — matching the UTC-midnight storage convention.
- **§6.2 Choke points** — `buildPresenzeMonthData` (5a, auto-covers report + export + Feature 1), dashboard live counts + `computeOreChart` (5b), `computeLeaveBalanceFromData` accrual cap + interface + both call sites (Task 3), `leaves/by-employee` + `settings/users` dropdown + `withoutPayrollId` picker (5c).
- **§6.3 Secondary** — `anomaly-sync` suppression (Task 6); employee management `GET` returns `terminationDate` and does NOT hard-exclude (5c Step 2d + Task 8 UI toggle). Record-driven historical endpoints (`stats`, `export`, `leaves/calendar`) deliberately left intact.
- **§6.4 Write guards** — kiosk punch, telegram `doPunch` (punch-only; read commands intact), import loop (compares `record.date`, back-dated allowed), `leaves` + `external/leaves` POST (Task 7), all via the tested pure `isTerminatedOnDate`.
- **§7 Accrual cap** — Task 3 caps at termination month inclusive, before the existing clamp, using the same local-`Date` convention as `hireDate`; carryOver/adjust untouched. Tests cover termination-year partial, year-after=0, year-before unchanged, part-time proportion, hire+term same year, adjust-on-top.
- **§8 UI** — Task 8: "Termina rapporto" (date default today + reason + note + ConfirmProvider dialog), "Riattiva", list "Cessato" badge + default-hidden "Mostra cessati" toggle. Hard delete left in place (already destructive-labelled).
- **§9 Edge cases** — term < hire validated (Task 4 throws); pending/approved leaves beyond termination produce warnings (Task 4 + surfaced as toasts in Task 8); today-boundary inclusive (Task 2 boundary tests: terminated today = active today, inactive tomorrow); same-name re-hire reuses the row (Task 4 `DELETE`). The mid-month `classifyDay`/`buildPresenzeMonthData` `isActiveOn` contract is honored by 5a feeding Feature 1.
- **§10 Testing** — pure-unit coverage for `isActiveOn`/`activeOnWhere` (Task 2), accrual cap (Task 3), `planTermination`/`isTerminatedOnDate` (Task 4), `shouldSuppressAnomaly` (Task 6). Prisma-touching routes are thin wrappers over these tested functions with build + curl manual-verification steps (mirrors the `computeLeaveBalanceFromData` pure / `computeLeaveBalance` wrapper precedent — no test-DB harness exists in this repo).
- **§11 Sequencing** — task order matches the spec build order (schema → primitive → accrual → action+route → choke points → guards → UI), foundational for Feature 1.
