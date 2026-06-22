/**
 * Day-scoped leave editing for the Revisione Presenze popup.
 *
 * The grid lets an admin double-click a single (employee, date) cell and
 * add / edit / remove the leave covering THAT day — even when the underlying
 * LeaveRequest spans a multi-day range. "Editing one day" of a multi-day leave
 * therefore means SPLITTING the range around that date:
 *
 *   ferie 03 → 07, remove 05  ⇒  ferie 03 → 04  +  ferie 06 → 07
 *
 * Operations are transactional and audited (LeaveRequestEdit). A fully-removed
 * single-day leave is DELETED — matching the existing DELETE route, its audit
 * rows cascade away (LeaveRequestEdit.leaveId FK onDelete: Cascade), so we do
 * not (cannot) keep a tombstone for it.
 *
 * Not handled (documented edge): a multi-day HOUR-BASED leave (e.g. a 2-day ROL
 * with a single `hours` total) keeps the same `hours` on both split halves. Such
 * leaves are atypical — ROL/permits are practically always single-day, where a
 * removal is a clean delete with no split. The common overage-fix case (a
 * single-day ROL coexisting with timbrature) never splits.
 */
import { prisma } from "../db";

export class DayLeaveError extends Error {
  constructor(public code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "DayLeaveError";
  }
}

/** Maps DayLeaveError codes to HTTP status for the route. */
export const DAY_LEAVE_ERROR_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  EDIT_NOT_ALLOWED_REJECTED: 403,
  DAY_NOT_IN_RANGE: 409,
};

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

/** Shift a YYYY-MM-DD calendar date by `deltaDays` (UTC-anchored, TZ-safe). */
export function shiftIsoDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + deltaDays * 86_400_000);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Subtract a single calendar `day` from [start, end], returning the surviving
 * sub-ranges. Pure.
 *   - day outside [start,end]  → [{start,end}] (unchanged; defensive)
 *   - single-day == day        → []            (fully removed)
 *   - day at start             → [{day+1, end}]
 *   - day at end               → [{start, day-1}]
 *   - day in the middle        → [{start, day-1}, {day+1, end}]
 */
export function subtractDayFromRange(start: string, end: string, day: string): DateRange[] {
  if (day < start || day > end) return [{ start, end }];
  const ranges: DateRange[] = [];
  if (start < day) ranges.push({ start, end: shiftIsoDate(day, -1) });
  if (day < end) ranges.push({ start: shiftIsoDate(day, 1), end });
  return ranges;
}

export type DayLeaveOp = "removeDay" | "editDay" | "add";

export interface DayLeaveOpInput {
  op: DayLeaveOp;
  employeeId: string;
  date: string; // YYYY-MM-DD
  leaveId?: string; // required for removeDay / editDay
  type?: string; // required for editDay / add
  hours?: number | null; // for hour-based types
  notes?: string | null;
  editorUserId: string;
  reason?: string | null;
}

export interface DayLeaveOpResult {
  op: DayLeaveOp;
  date: string;
  detachedFrom?: string; // leave the day was split/shrunk out of
  deletedLeaveId?: string; // single-day leave fully removed
  splitTailId?: string; // new tail leave from a mid-range split
  createdLeaveId?: string; // new single-day leave (editDay / add)
}

// Minimal shape of the prisma tx client we touch — keeps the pure-ish core
// testable against the same `$transaction(fn => fn(db))` mock the edit-service
// tests use.
type LeaveRow = {
  id: string;
  employeeId: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
  sickProtocol: string | null;
  notes: string | null;
  status: string;
  source: string;
  approvedById: string | null;
  approvedAt: Date | null;
};

async function detachDay(
  tx: typeof prisma,
  leave: LeaveRow,
  date: string,
  editorUserId: string,
  reason: string | null | undefined,
  result: DayLeaveOpResult,
): Promise<void> {
  const ranges = subtractDayFromRange(leave.startDate, leave.endDate, date);

  if (ranges.length === 0) {
    // Single-day leave on `date`: delete it (audit cascades away, like DELETE route).
    await tx.leaveRequest.delete({ where: { id: leave.id } });
    result.deletedLeaveId = leave.id;
    return;
  }

  // First surviving range stays on the original leave (shrink), audited UPDATE.
  const first = ranges[0];
  await tx.leaveRequest.update({
    where: { id: leave.id },
    data: { startDate: first.start, endDate: first.end, version: { increment: 1 } },
  });
  await tx.leaveRequestEdit.create({
    data: {
      leaveId: leave.id,
      editedById: editorUserId,
      oldType: leave.type, oldStartDate: leave.startDate, oldEndDate: leave.endDate,
      oldHours: leave.hours, oldTimeSlots: leave.timeSlots, oldSickProtocol: leave.sickProtocol,
      oldNotes: leave.notes, oldStatus: leave.status,
      newType: leave.type, newStartDate: first.start, newEndDate: first.end,
      newHours: leave.hours, newTimeSlots: leave.timeSlots, newSickProtocol: leave.sickProtocol,
      newNotes: leave.notes, newStatus: leave.status,
      reason: reason ?? `[Revisione presenze] rimosso giorno ${date}`,
      changedFields: JSON.stringify(
        [leave.startDate !== first.start ? "startDate" : null, leave.endDate !== first.end ? "endDate" : null].filter(Boolean),
      ),
    },
  });
  result.detachedFrom = leave.id;

  // Mid-range removal → a second range survives as a NEW tail leave (audited CREATE).
  if (ranges.length === 2) {
    const second = ranges[1];
    const tail = await tx.leaveRequest.create({
      data: {
        employeeId: leave.employeeId,
        type: leave.type,
        startDate: second.start,
        endDate: second.end,
        hours: leave.hours,
        timeSlots: leave.timeSlots,
        sickProtocol: leave.sickProtocol,
        notes: leave.notes,
        status: leave.status,
        source: leave.source,
        approvedById: leave.approvedById,
        approvedAt: leave.approvedAt,
      },
    });
    result.splitTailId = tail.id;
    await tx.leaveRequestEdit.create({
      data: {
        leaveId: tail.id,
        editedById: editorUserId,
        newType: tail.type, newStartDate: tail.startDate, newEndDate: tail.endDate,
        newHours: tail.hours, newTimeSlots: tail.timeSlots, newSickProtocol: tail.sickProtocol,
        newNotes: tail.notes, newStatus: tail.status,
        reason: reason ?? `[Revisione presenze] coda split da ${leave.id} (rimosso ${date})`,
        changedFields: JSON.stringify(["startDate", "endDate"]),
      },
    });
  }
}

/**
 * Apply a single day-scoped leave operation transactionally.
 *   - removeDay: split/shrink/delete the day out of `leaveId`.
 *   - editDay:   detach the day from `leaveId`, then create a fresh single-day
 *                leave with the new `type`/`hours` for that date.
 *   - add:       create a single-day leave for the date (no detaching).
 *
 * Self-overlap is impossible by construction (editDay detaches first; add is an
 * explicit admin correction), so no overlap pre-check is run.
 */
export async function applyDayLeaveOp(input: DayLeaveOpInput): Promise<DayLeaveOpResult> {
  const { op, employeeId, date, leaveId, type, hours, notes, editorUserId, reason } = input;
  const result: DayLeaveOpResult = { op, date };

  return prisma.$transaction(async (tx) => {
    // 1. Detach the day from the target leave (removeDay / editDay).
    if (op === "removeDay" || op === "editDay") {
      if (!leaveId) throw new DayLeaveError("BAD_REQUEST", "leaveId richiesto");
      const leave = (await tx.leaveRequest.findUnique({ where: { id: leaveId } })) as LeaveRow | null;
      if (!leave) throw new DayLeaveError("NOT_FOUND", "Richiesta non trovata");
      if (leave.employeeId !== employeeId) throw new DayLeaveError("BAD_REQUEST", "Dipendente non corrisponde");
      if (leave.status === "REJECTED") throw new DayLeaveError("EDIT_NOT_ALLOWED_REJECTED", "Richiesta rifiutata non modificabile");
      if (date < leave.startDate || date > leave.endDate) {
        throw new DayLeaveError("DAY_NOT_IN_RANGE", "Il giorno non rientra nella richiesta");
      }
      await detachDay(tx as typeof prisma, leave, date, editorUserId, reason, result);
    }

    // 2. Create the replacement / added single-day leave (editDay / add).
    if (op === "editDay" || op === "add") {
      if (!type) throw new DayLeaveError("BAD_REQUEST", "type richiesto");
      const created = await tx.leaveRequest.create({
        data: {
          employeeId,
          type,
          startDate: date,
          endDate: date,
          hours: hours ?? null,
          notes: notes ?? null,
          status: "APPROVED",
          source: "MANAGER",
          approvedById: editorUserId,
          approvedAt: new Date(),
        },
      });
      result.createdLeaveId = created.id;
      await tx.leaveRequestEdit.create({
        data: {
          leaveId: created.id,
          editedById: editorUserId,
          newType: type, newStartDate: date, newEndDate: date,
          newHours: hours ?? null, newNotes: notes ?? null, newStatus: "APPROVED",
          reason: reason ?? `[Revisione presenze] ${op === "add" ? "aggiunta" : "modifica"} assenza ${date}`,
          changedFields: JSON.stringify(["type", "startDate", "endDate", "hours", "status"]),
        },
      });
    }

    return result;
  });
}
