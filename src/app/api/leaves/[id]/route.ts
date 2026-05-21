import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import { notifyLeaveDecision, notifyLeaveCancellation } from "@/lib/telegram-handlers";
import { sendMail } from "@/lib/mail-send";
import { leaveDecisionNotification, leaveCancellationNotification } from "@/lib/mail-templates";
import { notificationsBus } from "@/lib/notifications-bus";
import { editLeaveSchema } from "@/lib/leaves/validation";
import { editLeaveRequest, LeaveEditError } from "@/lib/leaves/edit-service";
import { notifyLeaveEdited } from "@/lib/leave-notifications";
import { computeDiff, formatDiffForNotification } from "@/lib/leaves/audit";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: true, approvedBy: true },
  });

  if (!leave) {
    return NextResponse.json({ error: "Richiesta non trovata" }, { status: 404 });
  }

  return NextResponse.json({
    id: leave.id,
    employeeId: leave.employeeId,
    employeeName: leave.employee.displayName || leave.employee.name,
    type: leave.type,
    typeLabel: LEAVE_TYPES[leave.type as LeaveType]?.label ?? leave.type,
    startDate: leave.startDate,
    endDate: leave.endDate,
    hours: leave.hours,
    timeSlots: leave.timeSlots ? JSON.parse(leave.timeSlots) : null,
    sickProtocol: leave.sickProtocol,
    notes: leave.notes,
    status: leave.status,
    source: leave.source,
    createdAt: leave.createdAt.toISOString(),
    approvedBy: leave.approvedBy?.name ?? null,
    approvedAt: leave.approvedAt?.toISOString() ?? null,
    version: leave.version,
  });
}

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

  // Branch A: status-only body → approve/reject (existing flow preserved).
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

  // Branch B: edit. Admin only enforced by checkAuth above.
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

    // Load employee + editor names for notification and bus payload.
    const fullLeave = result.leaveRequest
      ? await prisma.leaveRequest.findUnique({
          where: { id: result.leaveRequest.id },
          include: { employee: true },
        })
      : null;
    const editor = await prisma.user.findUnique({
      where: { id: editorUserId },
      select: { name: true },
    });

    if (fullLeave && result.changedFields.length > 0) {
      // Reconstruct prev/next snapshots from audit row + current leave.
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
      const employeeName = fullLeave.employee.displayName || fullLeave.employee.name;

      // Fire-and-forget email + Telegram (does not block the response).
      void notifyLeaveEdited({
        employeeEmail: fullLeave.employee.email,
        employeeName,
        employeeChatId: fullLeave.employee.telegramChatId,
        adminName: editor?.name ?? "Admin",
        createdAt: fullLeave.createdAt.toISOString(),
        diffBody: formatted.body,
        telegramBody: formatted.telegramBody,
        reason: parsed.data.reason ?? null,
        status: fullLeave.status,
      });

      try {
        notificationsBus.publish({
          employeeId: fullLeave.employeeId,
          employeeName: fullLeave.employee.displayName || fullLeave.employee.name,
          action: "LEAVE_EDITED",
          time: LEAVE_TYPES[fullLeave.type as LeaveType]?.label ?? fullLeave.type,
          date: fullLeave.startDate,
          details: {
            leaveId: fullLeave.id,
            leaveType: fullLeave.type,
            leaveStartDate: fullLeave.startDate,
            leaveEndDate: fullLeave.endDate,
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: true },
  });
  if (!leave) {
    return NextResponse.json({ error: "Richiesta non trovata" }, { status: 404 });
  }

  // Motivo opzionale (da body JSON o da query string). DELETE in HTTP
  // puo' avere un body ma non tutti i client lo mandano, accettiamo
  // anche ?reason=... come fallback.
  let reason: string | null = null;
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim();
    }
  } catch {
    // ignore
  }
  if (!reason) {
    const urlReason = new URL(request.url).searchParams.get("reason");
    if (urlReason && urlReason.trim()) reason = urlReason.trim();
  }

  const previousStatus = leave.status as "PENDING" | "APPROVED" | "REJECTED";

  await prisma.leaveRequest.delete({ where: { id } });

  // Notifica al dipendente (Telegram + email) per PENDING e APPROVED.
  // Niente notifica per REJECTED: lo status finale e' lo stesso
  // (nessun impatto pratico per il dipendente) e sarebbe solo rumore.
  if (previousStatus === "PENDING" || previousStatus === "APPROVED") {
    try {
      await notifyLeaveCancellation({
        employeeChatId: leave.employee.telegramChatId,
        previousStatus,
        startDate: leave.startDate,
        endDate: leave.endDate,
        reason,
      });
    } catch (err) {
      console.error("[leaves/DELETE] notifyLeaveCancellation failed:", err);
    }

    if (leave.employee.email) {
      try {
        const reply = leaveCancellationNotification({
          previousStatus,
          startDate: leave.startDate,
          endDate: leave.endDate,
          employeeName: leave.employee.displayName || leave.employee.name,
          reason,
        });
        await sendMail({
          to: leave.employee.email,
          subject: reply.subject,
          text: reply.text,
          html: reply.html,
        });
      } catch (err) {
        console.error("[leaves/DELETE] sendMail cancellation failed:", err);
      }
    }
  }

  // Pubblica sul bus per far reagire sidebar + pagina ferie. Emettiamo
  // anche quando previousStatus === "REJECTED" perché la riga scompare
  // dalla lista delle richieste.
  try {
    notificationsBus.publish({
      employeeId: leave.employeeId,
      employeeName: leave.employee.displayName || leave.employee.name,
      action: "LEAVE_CANCELLED",
      time: LEAVE_TYPES[leave.type as LeaveType]?.label ?? leave.type,
      date: leave.startDate,
      details: {
        leaveId: leave.id,
        leaveType: leave.type,
        leaveStartDate: leave.startDate,
        leaveEndDate: leave.endDate,
      },
    });
  } catch (err) {
    console.error("[leaves/DELETE] bus publish failed:", err);
  }

  return NextResponse.json({ success: true, previousStatus });
}
