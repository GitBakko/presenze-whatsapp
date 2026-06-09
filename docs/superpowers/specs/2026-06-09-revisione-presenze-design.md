# Revisione Presenze — Design Spec

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — pending implementation plan
**Feature:** End-of-month attendance review & in-place correction page, before the existing auto-report fires.

---

## 1. Problem & Goal

At month-end an Excel "foglio presenze" is auto-mailed to the company owners (`titolari`). Today this is fully unattended: there is **no surface to review the data or fix incoherences before it goes out**. The owner needs an activity where, at month-end, they can:

1. See **exactly** what the report will contain.
2. See every **"rosso"** — data incoherent with what's expected.
3. **Fix** those data points in place.
4. Let the report auto-send (unchanged schedule) with corrected data.

**Success criteria:** the review page renders the same per-day hours the emailed xlsx will, every incoherence is surfaced and actionable, a correction writes to the real attendance records (so dashboard/export/report all stay consistent), and every edit is audited.

## 2. Decisions (locked in brainstorming)

| # | Decision |
|---|----------|
| D1 | **Separate review page**; the automatic monthly send stays as-is (no approval gate blocking it). |
| D2 | A correction edits the **underlying `AttendanceRecord`** rows (not a report-only override layer) → everything recomputes consistently. |
| D3 | "Rosso" = **structural anomalies + possible anomalies + ore ≠ orario contrattuale**, and (assumption A1) **unjustified absence** is included as a red case. |
| D4 | What the review page shows **must equal** what the report sends — single computation path. |

**Assumption A1 (flagged, not yet vetoed):** an unjustified absence — a scheduled working day with zero attendance records and zero approved leave — is treated as `status: absent` red. Today this is invisible except on the live dashboard.

## 3. Non-goals (YAGNI)

- No report-only override layer (D2 chose real-record edits).
- No rebuild of the existing `/records` flat table page.
- No change to the auto-send schedule/trigger (`generateAndSend` keeps firing on `monthlyReportDay`).
- No new editability of `messageTime`, `source`, or `isManual` (unchanged from current record contract).

## 4. Current-state grounding (from codebase map)

- The emailed report **is** the `/api/export/presenze` xlsx: `generateAndSend()` (`src/lib/monthly-report-worker.ts`) calls `buildPresenzeMonthData(year, month)` + `generatePresenzeXlsx(data)` (`src/lib/excel-presenze.ts`) for the **previous calendar month**, base64-attaches it, mails to `User` where `role=ADMIN, active, receiveMonthlyReport`.
- `buildPresenzeMonthData` and `generatePresenzeXlsx` are **pure** given `(year, month)`. The xlsx already colors cells: **red `FFFF0000`** when `worked+leave < scheduled` that day, **yellow `FFFFFF00`** when `> scheduled`. Hours come from `calculateDailyStats(...).hoursWorked`.
- Anomalies split into **structural** (`MISSING_EXIT`, `MISSING_ENTRY`, `MISMATCHED_PAIRS`, `PAUSE_NO_END`, `OVERTIME_NO_END`) — persisted in the `Anomaly` table by `syncAnomalies` (`src/lib/anomaly-sync.ts`) — and **possible/computed** (`TIME_OVERLAP`, `TIME_BLOCK_MISMATCH`) — recomputed live, never persisted. Both originate in `calculateDailyStats` (`src/lib/calculator.ts`).
- A scheduled working day with **zero records** never invokes `calculateDailyStats`, so it produces no anomaly and (today) no red signal in the data layer.
- Record editing gaps: only `PUT /api/records/[id]` recomputes anomalies (`resyncAnomaliesForDates`); `POST /api/records` and `DELETE /api/records/[id]` do **not**. The `/employees/[id]` day editor saves via **N parallel `PUT`** calls (partial-failure unsafe). `AttendanceRecord` has **no audit log and no version field** (unlike `LeaveRequestEdit`).
- `AttendanceRecord` identity: `@@unique([employeeId, date, type, declaredTime])`; `declaredTime` is the only editable time and the only one in the unique key; `messageTime` is never editable.

## 5. Architecture

Three layers, built bottom-up.

### 5.1 Classification layer (foundational refactor)

Define the canonical "is this cell red" logic **once**, as a pure function, and have both the xlsx and the review UI consume it.

```
src/lib/presenze/classify.ts

type DayStatus = "ok" | "under" | "over" | "absent" | "non_working";

interface DayClassification {
  date: string;              // YYYY-MM-DD
  status: DayStatus;
  scheduledHours: number;    // contracted hours that day (0 on non-working)
  workedHours: number;       // calculateDailyStats hoursWorked
  leaveHours: number;        // hours covered by approved leave
  effectiveHours: number;    // worked + leave, what's compared to scheduled
  anomalies: { type: string; description: string; severity: "structural" | "possible" }[];
  isRed: boolean;            // status under|absent OR any structural anomaly
  isYellow: boolean;         // status over OR only possible anomalies
}

function classifyDay(args: {
  date: string;
  schedule: EmployeeScheduleDay | null;
  dailyStats: DailyStats | null;   // null = no records that day
  leaves: ApprovedLeaveForDay;     // full-day / half-day / hourly coverage
  isNonWorkingDay: boolean;        // weekend/holiday via existing helper
  isActiveOnDay: boolean;          // Feature 2 isActiveOn(emp, date); false → non_working
}): DayClassification;
```

Rules:
- Non-working day (weekend/holiday via the existing `isNonWorkingDay`) → `non_working`, never red.
- **Out of the employee's active window** (`date < hireDate` or `date > terminationDate`, via Feature 2's `isActiveOn`) → `non_working`, never red. This prevents a mid-month leaver's post-termination days from showing as false absences. `classifyDay` takes an `isActiveOnDay: boolean` arg; `buildPresenzeMonthData` computes it per (employee, day).
- Working day, `dailyStats == null`, no leave → `absent` (red). *(Assumption A1.)*
- Working day with records: `effectiveHours = workedHours + leaveHours`; `< scheduled` → `under` (red), `> scheduled` → `over` (yellow), else `ok`.
- Anomalies attached from `dailyStats.anomalies`, tagged structural vs possible using the existing `COMPUTED_TYPES` set (`TIME_OVERLAP`, `TIME_BLOCK_MISMATCH` → possible).
- `isRed` = `status ∈ {under, absent}` OR any structural anomaly present. `isYellow` = `status == over` OR (only possible anomalies, no red).

**Refactor `buildPresenzeMonthData`** (`src/lib/excel-presenze.ts`) to compute and return a `DayClassification` per (employee, day) alongside the existing O / F-P render values. `generatePresenzeXlsx` keeps producing the identical sheet (reads `isRed`/`isYellow` instead of inlining the comparison) — **no visual change to the emailed report**. This guarantees D4 (page == report).

### 5.2 Review API

`GET /api/presenze/review?month=YYYY-MM` (admin only via `checkAuth()`). Default month = previous calendar month (matches the report). Returns:

```
{
  month: "YYYY-MM",
  reportDay: number,            // monthlyReportDay setting, for the banner
  reportEnabled: boolean,       // monthlyReportEnabled
  alreadySent: boolean,         // lastReportSent === this month
  employees: [{
    employeeId, name, displayName,
    days: DayClassification[],  // one per day of month
    overtimeTotal: number
  }],
  issues: Issue[]               // flattened red/yellow list, sortable
}

interface Issue {
  employeeId; employeeName; date;
  status: DayStatus;
  severity: "red" | "yellow";
  reasons: string[];            // human descriptions (anomaly descs + "ore sotto soglia" / "assenza")
  recordIds: string[];          // editable records on that day (may be empty for absence)
}
```

Built directly on the refactored `buildPresenzeMonthData` so it reuses the exact report computation. Terminated employees are already excluded here once Feature 2 lands (see §8).

### 5.3 Review page

Route: `src/app/(dashboard)/presenze/page.tsx` (admin). Sections:

- **Month picker** (default previous month) + status banner: *"Report di {mese} {anno} — parte il giorno {reportDay}"*, with `alreadySent` / `reportEnabled` states.
- **Grid** mirroring the xlsx layout (employees × days, red/yellow/absence cells) for familiarity. Cells with issues are clickable → open the **day editor** (§5.4). Filters: "solo rossi", per-employee.
- **Issue panel**: the `issues[]` list, sortable by employee/date/severity, each row jumps to its day editor. This is the primary "what doesn't add up" worklist.
- **Pre-send heads-up (optional, D1):** a notification 1–2 days before `reportDay` if red issues remain for the month being reported. Implemented as a check in the existing `monthly-report-worker` hourly tick (publish a `notificationsBus` event / mail to admins). Auto-send still fires regardless — this only prevents a silently-bad sheet. *Include unless vetoed.*

### 5.4 Editing — real records, safely

Three fixes to the current record-edit weaknesses, centralized behind one endpoint.

**Batch day endpoint** — `PUT /api/presenze/review/day` (admin):

```
body: { employeeId, date, records: [{ id?, type, declaredTime }] }
```

Semantics, in a single `prisma.$transaction`:
- Diff the submitted set against existing records for `(employeeId, date)`.
- Create new (`id` absent), update changed `declaredTime`/`type`, delete omitted. Enforce `@@unique([employeeId,date,type,declaredTime])` → 409 on collision with a clear message.
- New records: `source="MANUAL"`, `isManual=true`, `messageTime=declaredTime`, `rawMessage="[Revisione presenze] …"` (consistent with current manual-create contract).
- After the transaction: run **one** `calculateDailyStats` + `syncAnomalies` for that day (closes the POST/DELETE recompute gap). Publish a single `notificationsBus` event.
- Write **audit** rows (below) for every create/update/delete in the batch.

The existing `/employees/[id]` day editor is repointed to this batch endpoint (replaces its N-parallel-PUT loop), so both editors share one safe path.

**Record audit log** — new Prisma model mirroring `LeaveRequestEdit`:

```
model AttendanceRecordEdit {
  id          String   @id @default(cuid())
  recordId    String?           // null if the record was deleted
  employeeId  String
  date        String            // YYYY-MM-DD, for range queries
  editedById  String
  editedAt    DateTime @default(now())
  action      String            // CREATE | UPDATE | DELETE
  oldType         String?
  oldDeclaredTime String?
  newType         String?
  newDeclaredTime String?
  reason          String?       // optional free text from the review UI
  source          String        // "REVIEW" | "RECORDS" | "ANOMALY_RESOLUTION"
  editedBy User @relation(fields: [editedById], references: [id])
  @@index([employeeId, date])
  @@index([recordId])
  @@index([editedById])
}
```

Applied via `db:push`. All three write paths (`/api/presenze/review/day`, `/api/records/[id]`, `/api/anomalies/[id]` action edits) record into it, so record history matches the existing leave-edit auditability.

## 6. Data model changes

- New model `AttendanceRecordEdit` (§5.4) + back-relation `User.attendanceRecordEdits`.
- No change to `AttendanceRecord` shape (no `version` field for v1 — single-admin reviewer, low concurrency; the batch transaction + unique constraint are sufficient guards. Add `version` only if multi-admin concurrent editing becomes real).

## 7. Edge cases

- **Half-day / hourly leave** on a day with partial work: `leaveHours` from `LEAVE_TYPES` mapping (reuse `FULL_DAY_LEAVE_TYPES` / `HALF_DAY_LEAVE_TYPES` and the ROL/visita per-hour logic already in `excel-presenze.ts`) so `effectiveHours` doesn't false-flag a legitimately-covered day as `under`.
- **`syncAnomalies` already skips full-day-leave dates** — keep that; an absent day fully covered by leave is `non_working`/`ok`, not red.
- **Empty (absent) day has no `recordIds`** — the day editor opens with an empty record set; the admin adds punches or (correctly) leaves it as a real absence.
- **Month boundary:** review default month = previous month, same as the report's `prevMonth` computation; the picker allows any month.
- **Already-sent month:** banner shows `alreadySent`; edits still allowed (data fixes for the dashboard/export remain valid even after the email went out).

## 8. Interaction with Feature 2 (Fine Rapporto)

The review/report employee set funnels through `buildPresenzeMonthData`. Once Feature 2 adds `isActiveOn(emp, monthEnd)` there, terminated employees automatically drop from both the review page and the emailed report for months after termination — **no extra work in this feature**. This is why Feature 2's primitive lands first (see its spec §Sequencing).

## 9. Testing

- **Unit (`classifyDay`)**: each `DayStatus` branch — non-working, absent, under, over, ok; structural vs possible anomaly tagging; leave-covered day not flagged; half-day partial coverage. (vitest, pure function — high coverage, no DB.)
- **Unit (`buildPresenzeMonthData`)**: classification matches the xlsx cell colors for a fixture month (regression: emailed sheet unchanged).
- **API (batch day endpoint)**: create/update/delete diff; unique-collision → 409; single recompute fires; audit rows written; transaction rolls back on partial failure.
- **API (review GET)**: issue list completeness for a fixture month containing every red category.

## 10. Implementation phases (for the plan)

1. `classifyDay` + tests.
2. Refactor `buildPresenzeMonthData`/`generatePresenzeXlsx` onto `classifyDay` (regression test: identical xlsx).
3. `AttendanceRecordEdit` model + audit wiring into existing record write paths.
4. Batch day endpoint + repoint `/employees/[id]` editor.
5. Review API.
6. Review page UI.
7. Optional pre-send heads-up notification.
