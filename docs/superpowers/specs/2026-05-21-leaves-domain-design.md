# Leaves Domain — Coherent Phase Design

**Date:** 2026-05-21
**Status:** Approved (brainstorming complete, awaiting implementation plan)
**Scope:** Working-days computation with holiday awareness, admin edit of approved/pending requests with audit trail, overlap policy across creation paths, email-ingest type detection, parser past-date rejection.

---

## 1. Background

The audit on 2026-05-21 (`/audit profondo HR`) surfaced 5 issues clustered in the leave-request domain. Tackling them as one coherent phase prevents touching the same files across separate phases and lets the new module structure absorb all of them at once.

Issues covered:

| # | Source | Title |
|---|--------|-------|
| 1 | User appunto #1 + audit C6 | Holidays not excluded from leave-day count |
| 2 | User appunto #2 + audit H1 | Admin cannot edit approved/pending requests |
| 3 | Audit H3 | New leave overlap with existing approved leave not checked |
| 4 | Audit M6 | Email ingest hardcodes `type = VACATION` |
| 5 | Audit M7 | `parseLeaveDates` assigns current year to past dates silently |

Out of scope (separate phases):
- Schema string-as-enum hardening (H7)
- TZ rewrite for non-leaves code (C1)
- N+1 dashboard (H4)
- Workers observability (H9)

## 2. Decisions (from brainstorming)

| Topic | Decision |
|-------|----------|
| Non-working days excluded | Weekend (Sat/Sun) + Italian national holidays + San Feliciano 24/01 (single local). EmployeeSchedule per-employee remains as today (no change). |
| Storage strategy | Full range stored in DB (`startDate..endDate`). Effective working days computed at query time. |
| Admin edit scope | `APPROVED` + `PENDING` (not `REJECTED`). |
| Editable fields | `type`, `startDate`, `endDate`, `hours`, `timeSlots`, `sickProtocol`, `notes`. |
| Audit trail | Dedicated `LeaveRequestEdit` table with full old/new snapshots + `changedFields` JSON. |
| Edit notifications | Always sent (email + Telegram) on any edit. |
| Same-type overlap | Hard block always. |
| Cross-type overlap (SICK over VACATION) | `REQUIRES_CONFIRM` — admin can confirm to create the SICK; the conflicting VACATION is not auto-modified in this phase. |
| ROL on VACATION full day | Hard block (incoherent). |
| Email type detection | Subject parsing with keyword regex; falls back to reply `TYPE_UNKNOWN`. |
| Past-date parser | Reject with `PAST_DATE` error if `start < refDate - 7 days`. No auto-promote to next year. |

## 3. Architecture

Split the current monolithic `src/lib/leaves.ts` into a `src/lib/leaves/` module organized by concern. Pure logic separated from Prisma/notification side-effects. Back-compat preserved via `leaves/index.ts` re-export.

```
src/lib/leaves/
├── index.ts            # Public surface; re-exports for back-compat.
├── holidays.ts         # NEW. Wraps holidays-it.ts and adds San Feliciano 24/01.
├── working-days.ts     # NEW. Pure: isWorkingDay, countWorkDays, expandToWorkingDays.
├── balance.ts          # MIGRATED from leaves.ts. Uses working-days.ts.
├── overlap.ts          # NEW. Prisma read + pure classifier.
├── validation.ts       # NEW. Zod schemas + parseLeaveDates with PAST_DATE check + type detection.
├── audit.ts            # NEW. computeDiff, formatDiffForNotification.
├── edit-service.ts     # NEW. editLeaveRequest orchestration (transaction + audit + notify).
├── format.ts           # MIGRATED from leave-format.ts.
└── __tests__/          # vitest co-located with each module.
```

Touched outside the module:

- `prisma/schema.prisma` — add `LeaveRequestEdit` + back-relations + `version Int @default(0)` on `LeaveRequest`.
- `src/lib/leave-date-parser.ts` — becomes a thin re-export shim (deprecation comment).
- `src/lib/leave-format.ts` — re-export shim.
- `src/lib/leave-notifications.ts` — add `notifyLeaveEdited`.
- `src/lib/mail-templates.ts` — add 4 new templates.
- `src/lib/mail-ingest.ts` — type detection + overlap + new statuses.
- `src/lib/telegram-handlers.ts` — discriminated `ParseDatesResult` handling + overlap.
- `src/lib/notifications-bus.ts` — add `LEAVE_EDITED` event type.

## 4. Schema Delta

```prisma
model LeaveRequest {
  // ... existing fields ...
  version Int @default(0)  // optimistic-locking counter, incremented on every update
  edits LeaveRequestEdit[]
}

model User {
  // ... existing fields ...
  leaveEdits LeaveRequestEdit[] @relation("UserLeaveEdits")
}

model LeaveRequestEdit {
  id          String   @id @default(cuid())
  leaveId     String
  editedById  String
  editedAt    DateTime @default(now())

  oldType         String?
  oldStartDate    String?
  oldEndDate      String?
  oldHours        Float?
  oldTimeSlots    String?
  oldSickProtocol String?
  oldNotes        String?
  oldStatus       String?

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

Migration: `npm run db:push` (project convention). No backfill — `LeaveRequestEdit` starts empty, `version` defaults to 0.

## 5. Working-days + Holidays

### holidays.ts

```ts
import { isHoliday as isItalianHoliday } from "../holidays-it";

const LOCAL_HOLIDAYS_MMDD = new Set<string>(["01-24"]); // San Feliciano

export const isLocalHoliday = (date: string): boolean =>
  LOCAL_HOLIDAYS_MMDD.has(date.slice(5));

export const isPublicHoliday = (date: string): boolean =>
  isItalianHoliday(date) || isLocalHoliday(date);
```

### working-days.ts

```ts
// ScheduleMap is built by callers from EmployeeSchedule rows.
// Today EmployeeSchedule has rows only for dayOfWeek 1..5, so a full-time
// employee yields keys {1,2,3,4,5}. A part-time employee scheduled only
// Wed/Thu yields {3,4}. Sat=6 / Sun=7 are absent → excluded automatically.
export type ScheduleMap = Map<number, unknown>;

export function isWorkingDay(date: string, scheduleMap: ScheduleMap): boolean {
  const dow = dayOfWeekIso(date); // uses tz.ts (Europe/Rome)
  if (!scheduleMap.has(dow)) return false;
  if (isPublicHoliday(date)) return false;
  return true;
}

export function countWorkDays(start: string, end: string, sm: ScheduleMap): number;
export function expandToWorkingDays(start: string, end: string, sm: ScheduleMap): string[];
```

Pure: no Prisma imports, fully testable.

**Date iteration must operate on YYYY-MM-DD strings**, not `new Date()` instances, to avoid TZ shifts. `dayOfWeekIso` uses `src/lib/tz.ts` (Europe/Rome).

### Resolution examples

```
Fri 22/05/2026 → Mon 25/05/2026 (4 calendar days)
  Sat 23: scheduleMap missing dow=6 → excluded
  Sun 24: scheduleMap missing dow=7 → excluded
  → countWorkDays = 2 (Fri + Mon)

Thu 30/04/2026 → Mon 04/05/2026 (Fri 01/05 = Festa del Lavoro)
  01/05: isPublicHoliday=true → excluded
  02-03/05: weekend → excluded
  → countWorkDays = 2 (Thu + Mon)

Sat 23/01 → Mon 25/01/2027 (Sun 24/01 = San Feliciano)
  23-24/01: weekend → excluded (San Feliciano coincides with weekend, no penalty)
  → countWorkDays = 1 (Mon only)
```

`VACATION_HALF_AM`/`HALF_PM` continue to count 0.5 in `balance.ts` (logic unchanged). `SICK` continues to use calendar-day count (`countCalendarDays`) — INPS requires calendar days for sick leave.

## 6. Overlap Policy

### overlap.ts

```ts
export type OverlapKind = "BLOCK" | "REQUIRES_CONFIRM" | "OK";

export interface OverlapResult {
  kind: OverlapKind;
  conflicts: ExistingLeaveConflict[];
  reason?: string;
}

export async function checkOverlap(
  employeeId: string,
  request: { type; startDate; endDate; hours?; timeSlots? },
  options?: { excludeId?: string }
): Promise<OverlapResult>;
```

Query: single `findMany` on `LeaveRequest` with `status ∈ {APPROVED, PENDING}` and date-range intersection. `REJECTED` excluded.

### Decision matrix

| # | Existing | New | Verdict |
|---|----------|-----|---------|
| 1 | VACATION/HALF | VACATION/HALF same day | BLOCK (except HALF_AM + HALF_PM = OK) |
| 2 | ROL | ROL | check `timeSlots` intersection; BLOCK if overlap, OK if disjoint |
| 3 | VACATION (full) | ROL | BLOCK (incoherent) |
| 4 | VACATION_HALF_AM | ROL afternoon | OK |
| 5 | ROL morning | VACATION_HALF_PM | OK |
| 6 | non-SICK APPROVED | SICK | REQUIRES_CONFIRM |
| 7 | SICK | VACATION/ROL | BLOCK |
| 8 | SICK | SICK same day | BLOCK (dedup) |
| 9 | BEREAVEMENT/MARRIAGE/LAW_104/MEDICAL_VISIT | any intersecting type | BLOCK (one-off events; the query precondition already filters to date-intersecting rows) |

`classifyOverlap` is pure (existing + new → verdict). `checkOverlap` = Prisma wrapper + classifier.

### Integration

POST `/api/leaves`, POST `/api/external/leaves`, `mail-ingest`, `telegram-handlers` all call `checkOverlap` before create. On `REQUIRES_CONFIRM`, client must resubmit with `confirmOverride: true` (admin-only enforcement on server).

When SICK confirmed over existing VACATION: in this phase, SICK is created; the conflicting VACATION is **not** auto-truncated. Admin handles the balance manually. Future phase may add `overriddenBySickId` field.

## 7. Admin Edit + Audit

### edit-service.ts

```ts
export async function editLeaveRequest(
  leaveId: string,
  editorUserId: string,
  input: EditLeaveInput
): Promise<EditResult>;
```

Sequence (inside `$transaction`):

1. `findUnique` current request.
2. Guard `status ∈ {APPROVED, PENDING}` → else throw `EDIT_NOT_ALLOWED_REJECTED`.
3. Validate input via Zod (`validation.ts`).
4. Merge prev + delta → next state.
5. Optimistic-lock check: `input.version === current.version` → else throw `STALE_STATE`.
6. Re-check overlap with `excludeId = leaveId`.
7. `computeDiff(prev, next)`. If `changedFields.length === 0` → idempotent return.
8. `update LeaveRequest` (and `version++`).
9. `insert LeaveRequestEdit` with full old/new snapshot.

Outside transaction (best-effort):

10. `notifyLeaveEdited(employee, diff, editorName, reason?)` — email + Telegram.
11. `notificationsBus.publish({ type: "LEAVE_EDITED", leaveId, employeeId, changedFields })`.

### audit.ts

```ts
export function computeDiff(prev: LeaveRequest, next: LeaveRequest): LeaveDiff;
export function formatDiffForNotification(diff: LeaveDiff, locale: "it"):
  { subject: string; body: string; telegramBody: string };
```

Field-watched (closed list): `type, startDate, endDate, hours, timeSlots, sickProtocol, notes, status`. Other fields (createdAt, source, employeeId, approvedById, approvedAt) are never logged in audit.

### PUT `/api/leaves/[id]` — polymorphic body

```
Case A (back-compat, approve/reject):
  { status: "APPROVED" | "REJECTED", notes?: string }
Case B (edit, NEW):
  { type?, startDate?, endDate?, hours?, timeSlots?, sickProtocol?, notes?, reason?, version, confirmOverride? }
```

Disambiguation: presence of `status` in body → branch A (existing logic untouched). Otherwise → `editLeaveRequest`. Admin role required for both.

`version` field required in edit branch to enforce optimistic locking. If `version` is missing from an edit-shape body, return 400 `VALIDATION_FAILED` with field-level message.

Note: a PENDING request can be edited and then approved as two sequential operations (edit via case B, then approve via case A). Each operation increments `version`. The UI surfaces both buttons on PENDING rows.

### GET `/api/leaves/[id]/edits`

Returns `LeaveRequestEdit[]` ordered by `editedAt desc`. Admin only.

### Notification copy (Italian)

Email subject: `La tua richiesta di {type} è stata modificata`

Body:
```
Ciao {employeeName},

l'admin {adminName} ha modificato la tua richiesta inviata il {createdAt}.

Modifiche:
- Periodo: 22/05/2026 - 23/05/2026 → 25/05/2026 - 26/05/2026
- Ore: (invariato)
- Note: aggiornate

Motivo: {reason || "non specificato"}

Stato attuale: APPROVED.
```

Telegram (compact):
```
✏️ Richiesta {type} modificata da {adminName}:
- Periodo: 22/05 - 23/05 → 25/05 - 26/05
Motivo: {reason}
```

## 8. Email Ingest + Parser

### validation.ts

```ts
const TYPE_KEYWORDS: Array<[RegExp, string]> = [
  [/\bferi[ea]\b/i,                              "VACATION"],
  [/\brol\b|\bpermess[oi]\b/i,                   "ROL"],
  [/\bmalatti[ae]\b|\binfortuni[oi]\b/i,         "SICK"],
  [/\blutt[oi]\b/i,                              "BEREAVEMENT"],
  [/\bmatrimoni[oi]\b/i,                         "MARRIAGE"],
  [/\b104\b|\blegge 104\b/i,                     "LAW_104"],
  [/\bvisit[ae] medic[ao]\b|\bmedical[ei]\b/i,   "MEDICAL_VISIT"],
];

export function detectLeaveTypeFromSubject(subject: string): string | null;

export type ParseDatesResult =
  | { ok: true; startDate: string; endDate: string }
  | { ok: false; reason: "PAST_DATE" | "PARSE_ERROR" | "INVALID_RANGE"; detail?: string };

export function parseLeaveDates(body: string, refDate?: string): ParseDatesResult;
```

`parseLeaveDates` rules:
1. Extract `(startRaw, endRaw)` via existing regex.
2. For dates without explicit year: assume current year from `refDate`.
3. If `start < refDate - 7 days`: return `PAST_DATE`. Threshold tolerates legitimate backdating (Mon for previous Fri).
4. If `start > end`: return `INVALID_RANGE`.
5. No auto-promote to next year (user-chosen).

### mail-ingest.ts changes

```ts
const type = detectLeaveTypeFromSubject(subject);
if (!type) { await replyTypeUnknown(mail); log("TYPE_UNKNOWN"); return; }

const parsed = parseLeaveDates(body);
if (!parsed.ok) {
  if (parsed.reason === "PAST_DATE") { await replyPastDate(mail); log("PAST_DATE"); }
  else { await replyParseError(mail); log("PARSE_ERROR"); }
  return;
}

const overlap = await checkOverlap(employee.id, { type, ...parsed });
if (overlap.kind !== "OK") { await replyOverlap(mail, overlap.conflicts); log("OVERLAP_BLOCK"); return; }

await prisma.leaveRequest.create({ ... });
```

`EmailIngestLog.status` new values (string drift accepted in this phase): `TYPE_UNKNOWN`, `PAST_DATE`, `OVERLAP_BLOCK`.

`MAIL_FOLDER` env unchanged. Subject no longer required to be exactly "ferie" — any subject matching a `TYPE_KEYWORDS` regex is accepted. Back-compat: "ferie" still works.

### External API `/api/external/leaves` changes

- Zod validation on body (`type ∈ LEAVE_TYPES`, length caps on notes/timeSlots, `hours` in [0, 24]).
- Employee lookup precedence: `payrollId` (exact) > `email` (exact) > `name` (uniqueness check; if multiple active employees match, return 409 `AMBIGUOUS_EMPLOYEE`).
- Overlap check before create.

### Telegram handler changes

Each command (`/ferie`, `/permesso`, `/malattia`, etc.) already knows its `type` — no detection. Only changes:
- `parseLeaveDates` discriminated result handling: `PAST_DATE` → "❌ Data nel passato, ricontrolla".
- `checkOverlap` call before create: "❌ Conflitto con richiesta del DD/MM" on BLOCK.

## 9. UI

### CreateLeaveModal — preview-days block

Below date pickers, render:
```
Userai 2 giorni lavorativi.
2 giorni non lavorativi esclusi: Sab 23/05, Dom 24/05.
```

Fetch debounced 300ms: `POST /api/leaves/preview-days` with `{employeeId, startDate, endDate, type}` → `{effectiveDays, breakdown:[{date, working, reason?}]}`.

Error handling 409:
- `OVERLAP_BLOCK` → red banner with conflict detail, submit disabled.
- `OVERLAP_REQUIRES_CONFIRM` (admin only) → yellow banner "Conflitto con SICK esistente. Procedere?" with `Conferma e crea | Annulla`.

### EditLeaveModal (new file)

Reuse 70% of CreateLeaveModal via extracted `LeaveFormFields.tsx`. Props:
- `request: LeaveRequest` for prefill.
- `onClose`, `onSaved` callbacks.

Sections:
- Header: `Modifica richiesta {type} di {employeeName}`.
- Form fields (varies by type).
- Same preview-days block as Create.
- `Motivo modifica (interno)` textarea, optional.
- Accordion `Storia modifiche` — lazy fetch `/api/leaves/:id/edits` on expand.

Submit: `PUT /api/leaves/:id` with edit-shape body including `version` for optimistic lock.

`useModalA11y` + `ConfirmProvider` for dirty-form close confirmation.

### RequestsList

Add `Modifica` button (pencil icon) for rows with `status ∈ {APPROVED, PENDING}`. Approve/Reject buttons remain for PENDING. No edit affordance on REJECTED.

### page.tsx

```ts
const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(null);
const handleEditRequest = (r) => setEditingRequest(r);
// ... mount <EditLeaveModal request={editingRequest} ... /> when not null
```

Separate Create and Edit modals — no combined edit-flag mode. Clearer code.

## 10. API Summary

| Endpoint | Method | Change |
|----------|--------|--------|
| `/api/leaves` | POST | + Zod, + overlap, + past-date via `parseLeaveDates` |
| `/api/leaves/[id]` | PUT | polymorphic: status-only (back-compat) or edit (new) |
| `/api/leaves/[id]` | DELETE | unchanged |
| `/api/leaves/[id]/edits` | GET (new) | audit history, admin-only |
| `/api/leaves/preview-days` | POST (new) | working-days preview for modal |
| `/api/external/leaves` | POST | + Zod, + lookup precedence, + overlap |

### Error code catalog

| Code | HTTP | Trigger | UI handling |
|------|------|---------|-------------|
| `OVERLAP_BLOCK` | 409 | same-type overlap or incoherent overlap | red banner, no submit |
| `OVERLAP_REQUIRES_CONFIRM` | 409 | SICK over non-SICK APPROVED | yellow banner + confirm |
| `PAST_DATE` | 400 | date < refDate - 7 days | inline error |
| `INVALID_RANGE` | 400 | startDate > endDate | inline error |
| `TYPE_UNKNOWN` | 400 (email reply only) | subject keyword no match | reply email |
| `EDIT_NOT_ALLOWED_REJECTED` | 403 | edit on REJECTED | button hidden + toast |
| `STALE_STATE` | 409 | version mismatch on edit | "ricarica pagina" toast |
| `AMBIGUOUS_EMPLOYEE` | 409 | external API name match >1 | log + 409 |
| `VALIDATION_FAILED` | 400 | Zod failure | per-field inline |
| `NOT_FOUND` | 404 | leaveId missing | toast |

## 11. Error Handling and Transactions

**Transactional boundaries:**

- `editLeaveRequest`: `$transaction([update, audit insert])`. Notification + WS publish outside (best-effort, logged on failure).
- `createLeaveRequest`: `$transaction([final overlap check, create])`. Final overlap check inside closes TOCTOU window.
- `version` optimistic lock prevents lost-update on concurrent edits.

**Logging:** `OVERLAP_*` logged as `console.warn` with ids only (no PII). Unexpected errors `console.error` + generic 500 client-side.

## 12. Testing

Unit tests (vitest, co-located in `__tests__/`):

- `working-days.test.ts` — table-driven: Fri→Mon=2, holiday in middle excluded, San Feliciano excluded, holiday on weekend not double-counted, part-time schedule respected, reversed range = 0.
- `holidays.test.ts` — all 11 national + San Feliciano on multiple years.
- `overlap.test.ts` — all 9 matrix cases, Prisma mocked via `vi.mock`.
- `validation.test.ts` — `detectLeaveTypeFromSubject` priority, `parseLeaveDates` PAST_DATE threshold, invalid range.
- `audit.test.ts` — `computeDiff` no-op + single-field + multi-field, `formatDiffForNotification` snapshot.
- `edit-service.test.ts` — happy path + REJECTED throw + STALE_STATE + overlap block + no-op idempotency.

Integration tests deferred to Schema-hardening phase (H13).

Manual QA checklist (operator):
- [ ] Vacation Fri→Mon shows preview = 2.
- [ ] Vacation Thu 30/04 → Mon 04/05 excludes 01/05.
- [ ] Vacation 23-25 January 2027 excludes 24/01 (San Feliciano).
- [ ] Edit APPROVED with new dates: audit visible in modal, email + Telegram sent.
- [ ] Overlap on existing leave returns 409 with detail.
- [ ] SICK over VACATION: confirmation modal; confirm → SICK created.
- [ ] Email subject "rol 22/05" creates ROL (not VACATION).
- [ ] Email "ferie dal 15/04 al 18/04" sent in December returns PAST_DATE reply.

## 13. Rollout

Atomic commit sequence (this phase = commits 1-10):

1. `feat(leaves): add edit audit trail schema + version column`
2. `feat(leaves): extract working-days + holiday-aware count`
3. `refactor(leaves): split monolith into leaves/ module (back-compat re-export)`
4. `feat(leaves): zod validation + past-date parser`
5. `feat(leaves): overlap detection across creation paths`
6. `feat(leaves): admin edit with audit trail`
7. `feat(leaves): notify employee on admin edit`
8. `feat(leaves): working-days preview in create modal`
9. `feat(leaves): admin edit modal with history`
10. `feat(mail-ingest): detect leave type from subject`

Deferred to a separate cleanup phase (not part of this rollout):
- `refactor(leaves): remove deprecated re-export shims` — one release after commit 3 ships to prod.

**Rollback:** each commit is `git revert`-safe except commit 1 (schema), which requires `db:push` on rollback.

**Feature flag:** none.

**Backfill:** none. `LeaveRequestEdit` starts empty, `version` defaults to 0 for existing rows.

**Prod deploy:** standard pipeline per `project_hr_deploy_pipeline` memory. Schema migration (`db:push`) runs BEFORE code swap, because new code depends on `version` column.

**Estimated effort:** 3-4 full working days. 11 commits, ~33 files touched (19 new, ~14 modified), 6 test files.

## 14. Out of Scope (Acknowledged)

- TZ unification across non-leaves code (audit C1).
- N+1 in `api/stats/dashboard/route.ts` (audit H4).
- Schema enum hardening for `type/status/source` strings (audit H7).
- Workers observability (audit H9).
- SICK-overrides-VACATION auto-truncation (deferred to future phase; manual handling for now).
- Soft-delete on `LeaveRequest`.
- Integration tests on API routes (deferred to H13 phase).
