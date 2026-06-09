# Fine Rapporto (Employee Termination) — Design Spec

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — pending implementation plan
**Feature:** Soft, date-relative employee termination so a leaver stops counting in KPIs / controls / exports / report from a date X, while all history before X is preserved.

---

## 1. Problem & Goal

An employee can leave the company (resignation or dismissal). Today the `Employee` model has **no concept of termination**: the only ways to remove someone are a hard `prisma.employee.delete()` (which **cascade-destroys all attendance, leaves, balances, anomalies and the leave-edit audit trail**) or the import-time `ExcludedName` (which only skips a name during WhatsApp parsing). Neither lets an employee "stop counting from day X while keeping their history."

**Goal:** mark an employee terminated on a date X so that:
- From X onward they drop out of every KPI, control activity, export, and the monthly report.
- Before X they remain fully present and counted (a June leaver still appears in the May report).
- All historical records survive (Italian payroll/CCNL retention).
- Their reusable identifiers (NFC card, Telegram chat) are freed for the next hire.
- The action is reversible (re-activation / re-hire).

**Success criteria:** setting `terminationDate` removes the employee from forward-looking counts at the correct date boundary, leaves accrual stops, post-termination punches/leave requests are rejected, no historical report changes, and nothing is deleted.

## 2. Decisions (locked in brainstorming)

| # | Decision |
|---|----------|
| D1 | **Soft termination** via a nullable `terminationDate` on `Employee` (not a boolean `active`, not a hard delete). |
| D2 | **Date-relative** semantics: `isActiveOn(emp, D)` evaluated against the period date D, not a global "currently active" flag. |
| D3 | History preserved; **hard-delete reserved for "created by error"** and clearly marked destructive. |
| D4 | On termination, **free `nfcUid` + `telegramChatId`** for reuse; leave `email`/`payrollId` intact. |
| D5 | Accrual cap = **termination month inclusive** (v1); exact ≥15-day CCNL rule handled by the existing `vacationAccrualAdjust`/`rolAccrualAdjust` manual fields. |

## 3. Non-goals (YAGNI)

- No separate status state machine / enum table — a date is sufficient and is what every consumer actually needs.
- No automated payout calculation of residual ferie/ROL (admin uses the existing adjust fields).
- No exact ≥15-day final-month accrual logic in v1 (flagged as a possible refinement).
- No nulling of `email`/`payrollId` (rarely reused; payroll history risk).
- No mass-rehire / employee-merge tooling.

## 4. Current-state grounding (from codebase map)

- `Employee` has **no** `active`/`status`/`terminated`/`terminationDate` field. `User.active` is a login-activation flag on the *account*, unrelated to the employee population.
- Every child of `Employee` uses `onDelete: Cascade` (`AttendanceRecord`, `Anomaly`, `EmployeeSchedule`, `LeaveRequest`→`LeaveRequestEdit`, `LeaveBalance`, `EmployeeApiKey`). The current `DELETE` handler (`src/app/api/employees/[id]/route.ts`) hard-deletes and manually nulls `User.employeeId` first.
- Accrual lives in `computeLeaveBalanceFromData` (`src/lib/leaves/balance.ts`), purely **month-counted**: `monthsAccrued` has only a lower bound at `hireDate` (no upper bound). `EmployeeForBalance` interface carries `hireDate`; both the per-employee wrapper `computeLeaveBalance` and the dashboard batch path pass it.
- Unique constraints on `Employee`: `name`, `nfcUid`, `telegramChatId`, `email`, `payrollId`. The existing `PUT /api/employees/[id]` already supports unlinking `nfcUid` and `telegramChatId`.
- Enumeration surface (14 sites) and the central choke points are mapped in §6.

## 5. Data model changes

`Employee` gains:

```
terminationDate    DateTime?   // null = active; set = left on this date (inclusive last working day)
terminationReason  String?     // "RESIGNATION" | "DISMISSAL" | "OTHER" + optional free note
terminatedById     String?     // admin who performed the action (audit)
terminatedAt       DateTime?   // when the action was taken
```

`User` gains back-relation `terminatedEmployees Employee[] @relation("EmployeeTerminatedBy")` (or store `terminatedById` without a relation to keep it simple — relation preferred for consistency with existing `resolvedBy`/`approvedBy` patterns).

Applied via `db:push` (project convention — no migration files). `terminationDate` is the semantic source of truth; `isActive = terminationDate == null` is derived in code, never stored.

**Re-hire / re-activation:** "Riattiva" sets `terminationDate = terminationReason = terminatedById = terminatedAt = null`. Because `nfcUid`/`telegramChatId` were freed on termination, the admin re-assigns the card/chat on re-activation (acceptable; no stored-and-restored identity). `name @unique` is unaffected (the same historical row is reused).

## 6. The primitive & choke points

### 6.1 Primitive

```
src/lib/employees/active.ts

// Inclusive of both endpoints: active on day D iff hired on/before D and not terminated before D.
export function isActiveOn(
  emp: { hireDate: Date | null; terminationDate: Date | null },
  dateIso: string
): boolean {
  if (emp.hireDate && formatDateIsoIt(emp.hireDate) > dateIso) return false;
  if (emp.terminationDate && formatDateIsoIt(emp.terminationDate) < dateIso) return false;
  return true;
}

// Prisma where-fragment for list endpoints (D = today or period-end).
export function activeOnWhere(dateIso: string): Prisma.EmployeeWhereInput {
  return {
    AND: [
      { OR: [{ hireDate: null }, { hireDate: { lte: new Date(`${dateIso}T23:59:59`) } }] },
      { OR: [{ terminationDate: null }, { terminationDate: { gte: new Date(`${dateIso}T00:00:00`) } }] },
    ],
  };
}
```

Boundary convention: `terminationDate` is the employee's **last active day** (inclusive). Active on D iff `D <= terminationDate`.

**Anti-pattern to avoid:** scattering `where: { terminationDate: null }` (a global "currently active" filter) across sites — it breaks historical reports. Always filter relative to the period date D.

### 6.2 Central choke points (≈80% of surface)

| Site (file : function) | Filter |
|---|---|
| `src/lib/excel-presenze.ts : buildPresenzeMonthData` (employee query) | `activeOnWhere(monthEnd)` → **auto-covers the monthly report, the `/api/export/presenze` export, and the Feature 1 review page** |
| `src/app/api/stats/dashboard/route.ts : GET` (`allEmployees`) | `activeOnWhere(today)` for live `employeesToday`/`totalEmployees`; in `computeOreChart`, per-month `isActiveOn(emp, monthEnd)` so post-termination months don't inflate the contracted-hours denominator |
| `src/lib/leaves/balance.ts : computeLeaveBalanceFromData` | accrual cap (§7); add `terminationDate` to the `EmployeeForBalance` interface and both call sites |
| `src/app/api/leaves/by-employee/route.ts`, `src/app/api/settings/users/route.ts` (employee dropdown), `src/app/api/employees/route.ts` (`withoutPayrollId` picker) | `activeOnWhere(today)` |

### 6.3 Secondary sites

- `src/lib/anomaly-sync.ts : syncAnomalies` — suppress **new** anomaly creation for a day where `!isActiveOn(emp, ds.date)` (don't generate anomalies for post-termination dates).
- **Employee management list** (`src/app/api/employees/route.ts` main `GET`): do **not** hard-exclude. Return `terminationDate` and let the UI show terminated rows with a badge, default-hidden behind a "Mostra cessati" toggle (admins must still manage leavers).
- **Record-driven historical endpoints** (`src/app/api/stats/route.ts`, `src/app/api/export/route.ts`, `src/app/api/leaves/calendar/route.ts`): leave intact — they're event-driven over existing rows; a leaver's past data is valid history.

### 6.4 Write guards (reject post-termination mutations)

Reject when the target employee is terminated **as of the action/record date**:
- Punches: `src/app/api/kiosk/punch/route.ts` (NFC, after `nfcUid` lookup), `src/lib/telegram-handlers.ts` (after `telegramChatId` lookup), WhatsApp import name-resolution in `src/app/api/import/upload/route.ts`. Back-dated punches **before** `terminationDate` remain allowed.
- Leave creation: `src/app/api/leaves/route.ts`, `src/app/api/external/leaves/route.ts`, telegram/mail leave paths — reject any request whose `startDate > terminationDate`. Cleanest single chokepoint: the leave-creation service in `src/lib/leaves/` consumed by all routes (so every channel inherits the guard).
- After freeing `nfcUid`/`telegramChatId` on termination, NFC/Telegram lookups for that card/chat naturally miss → the leaver simply can't punch via those channels. The date guard covers the import path and any not-yet-freed identifier.

## 7. Accrual cap

In `computeLeaveBalanceFromData` (`src/lib/leaves/balance.ts`), `monthsAccrued` currently has only a lower bound at `hireDate`. Add `terminationDate` to the input and cap the **upper** bound:

- `year > terminationYear` → `monthsAccrued = 0`.
- `year == terminationYear` → upper month = `terminationMonth` (inclusive); `monthsAccrued = terminationMonth - startMonth + 1` (where `startMonth` already respects `hireDate`).
- `year < terminationYear` (or no termination) → unchanged.

`vacationCarryOver` / `rolCarryOver` and the manual `vacationAccrualAdjust` / `rolAccrualAdjust` from `LeaveBalance` are **not** auto-capped (they're deliberate overrides). Residual ferie/ROL settlement at exit is done by the admin via the adjust fields — this is their stated purpose (payslip realignment).

**CCNL nuance (D5, flagged):** a full final month is conventionally accrued if worked ≥15 days. v1 uses whole-month inclusive (simple, slightly generous/strict at the boundary); exact day-aware capping is a possible later refinement, mitigated meanwhile by the adjust fields.

## 8. UI

- **Employee edit/detail** (`src/app/(dashboard)/employees/[id]/...`): a "Termina rapporto" action — date picker (default today) + reason (RESIGNATION/DISMISSAL/OTHER + note) + confirm dialog explaining what happens (freed card/chat, drops from counts from the date). On submit: set the termination fields, null `nfcUid`/`telegramChatId` (reuse the existing PUT unlink logic), write `terminatedById`/`terminatedAt`.
- **Reversible "Riattiva"** on a terminated employee → clears the termination fields (card/chat must be re-assigned).
- **Employee list** (`src/app/(dashboard)/employees/page.tsx`): terminated rows shown with a badge (e.g. "Cessato — {date}"), **default-hidden** behind a "Mostra cessati" toggle.
- **Hard delete** stays available but relabeled/guarded as destructive ("Elimina definitivamente — cancella TUTTA la storia"), secondary to the soft action. Given the project's data-loss sensitivity, soft-termination is the primary path.

## 9. Edge cases

- **Termination mid-month:** the month of termination still appears in that month's report; days after `terminationDate` within that month classify as `non_working`/excluded (the review/report grid should not show post-termination days as red absences — `classifyDay` from Feature 1 must treat `date > terminationDate` as out-of-scope, not `absent`). **Cross-feature contract:** `classifyDay`/`buildPresenzeMonthData` skip days where `!isActiveOn(emp, date)`.
- **Termination before hireDate / invalid date:** validate `terminationDate >= hireDate` on the action.
- **Pending leave requests after termination date:** on terminate, surface a warning if approved/pending leaves exist beyond `terminationDate` (don't auto-delete — admin decides). v1: warn only.
- **Re-hire same person:** "Riattiva" reuses the row; if instead a brand-new `Employee` with the same `name` is created, `name @unique` collides — expected; admin reactivates the existing row.
- **Today-boundary:** an employee terminated **today** is active today (inclusive) and inactive tomorrow.

## 10. Testing

- **Unit (`isActiveOn` / `activeOnWhere`)**: hire floor, termination ceiling, inclusive boundaries, null cases, hire>D, term<D.
- **Unit (accrual cap in `computeLeaveBalanceFromData`)**: termination-year partial, year-after = 0, year-before unchanged, part-time proportion still applies, adjust fields still added.
- **Integration (choke points)**: terminated employee absent from dashboard `totalEmployees`/KPIs for today; absent from `buildPresenzeMonthData` for months after termination; **present** for months before termination (history regression).
- **Integration (write guards)**: post-termination NFC punch / leave request rejected; pre-termination back-dated punch accepted.
- **Integration (termination action)**: fields set, `nfcUid`/`telegramChatId` nulled and reusable by another employee, history rows intact, reversible.

## 11. Sequencing

This feature is foundational for Feature 1 (Revisione Presenze): Feature 1's `buildPresenzeMonthData` refactor is exactly where `activeOnWhere(monthEnd)` plugs in, and `classifyDay` must honor `isActiveOn` for mid-month terminations (§9). **Build order:**

1. Schema fields + `db:push`.
2. `isActiveOn` / `activeOnWhere` primitive + tests.
3. Accrual cap in `computeLeaveBalanceFromData` (+ interface/call-site plumbing).
4. Termination action endpoint + UI (terminate / reactivate / list toggle).
5. Apply choke-point filters (dashboard, leaves/by-employee, dropdowns).
6. Write guards (punches + leave creation).

Then Feature 1 consumes the filtered employee set and the `isActiveOn` contract.
