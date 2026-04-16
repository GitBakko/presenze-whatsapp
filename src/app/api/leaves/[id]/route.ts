import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import { notifyLeaveDecision, notifyLeaveCancellation } from "@/lib/telegram-handlers";
import { sendMail } from "@/lib/mail-send";
import { leaveDecisionNotification, leaveCancellationNotification } from "@/lib/mail-templates";

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

  const { status, notes } = body as { status?: string; notes?: string };

  const data: Record<string, unknown> = {};

  if (status && ["APPROVED", "REJECTED"].includes(status)) {
    data.status = status;
    data.approvedAt = new Date();
    // Verifica che l'user della sessione esista ancora in DB (difesa contro
    // cookie stale dopo reset del db in dev). Se non esiste, approve senza
    // riferimento all'utente invece di fallire con P2003.
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
  if (notes !== undefined) {
    data.notes = notes;
  }

  const updated = await prisma.leaveRequest.update({
    where: { id },
    data,
    include: { employee: true, approvedBy: true },
  });

  // Notifiche al dipendente (Telegram + email) su APPROVED/REJECTED.
  // Errori loggati ma non bloccano la response.
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
  });
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

  return NextResponse.json({ success: true, previousStatus });
}
