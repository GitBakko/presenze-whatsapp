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
    super(`${code}: ${message}`);
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

    const next = {
      type: input.type ?? current.type,
      startDate: input.startDate ?? current.startDate,
      endDate: input.endDate ?? current.endDate,
      hours: input.hours !== undefined ? input.hours : current.hours,
      timeSlots: input.timeSlots !== undefined ? (input.timeSlots ? JSON.stringify(input.timeSlots) : null) : current.timeSlots,
      sickProtocol: input.sickProtocol !== undefined ? input.sickProtocol : current.sickProtocol,
      notes: input.notes !== undefined ? input.notes : current.notes,
      status: current.status,
    };

    if (next.startDate > next.endDate) {
      throw new LeaveEditError("INVALID_RANGE", "startDate must be <= endDate after edit");
    }

    const diff = computeDiff(current, next);
    if (diff.changedFields.length === 0) {
      return { leaveRequest: current, changedFields: [], audit: null };
    }

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
