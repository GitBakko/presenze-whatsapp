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
