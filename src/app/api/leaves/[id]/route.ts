import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import { notifyLeaveDecision } from "@/lib/telegram-handlers";
import { sendMail } from "@/lib/mail-send";
import { leaveDecisionNotification } from "@/lib/mail-templates";

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
    data.approvedById = session?.user?.id ?? null;
    data.approvedAt = new Date();
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave) {
    return NextResponse.json({ error: "Richiesta non trovata" }, { status: 404 });
  }

  await prisma.leaveRequest.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
