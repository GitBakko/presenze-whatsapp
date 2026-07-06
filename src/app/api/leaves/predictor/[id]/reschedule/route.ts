import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { todayRome } from "@/lib/tz";
import { recomputeAmortization } from "@/lib/leaves/amortization-service";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import { notifyLeaveCancellation } from "@/lib/telegram-handlers";
import { sendMail } from "@/lib/mail-send";
import { leaveCancellationNotification } from "@/lib/mail-templates";
import { notificationsBus } from "@/lib/notifications-bus";

/**
 * POST /api/leaves/predictor/[id]/reschedule
 *
 * Admin-only. "Il dipendente non può fare ferie quel giorno": the predictor day
 * is vetoed (persisted as LeavePredictorExclusion so no future recompute picks
 * it again), the leave row is removed, and the plan is regenerated — the engine
 * places the day elsewhere.
 *
 * A CONFIRMED day is HR-committed and may have been communicated to the
 * employee: rescheduling it triggers the same cancellation notice the normal
 * delete flow sends (Telegram + email). Unconfirmed proposals are internal —
 * no notice.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({ where: { id }, include: { employee: true } });
  if (!leave) {
    return NextResponse.json({ error: "Richiesta non trovata" }, { status: 404 });
  }
  if (leave.source !== "PREDICTOR") {
    return NextResponse.json({ error: "Solo i giorni del predittore sono rischedulabili" }, { status: 400 });
  }
  if (leave.startDate <= todayRome()) {
    return NextResponse.json({ error: "Impossibile rischedulare un giorno passato o odierno" }, { status: 400 });
  }

  const session = await auth();
  await prisma.$transaction([
    prisma.leavePredictorExclusion.upsert({
      where: { employeeId_date: { employeeId: leave.employeeId, date: leave.startDate } },
      create: { employeeId: leave.employeeId, date: leave.startDate, createdById: session?.user?.id ?? null },
      update: {},
    }),
    prisma.leaveRequest.delete({ where: { id } }),
  ]);

  const year = Number(leave.startDate.slice(0, 4));
  const result = await recomputeAmortization(year, "RESCHEDULE", session?.user?.id);

  // Confirmed day = committed to the employee → same cancellation notice as
  // the delete flow. Best-effort: the reschedule already succeeded.
  if (leave.confirmedAt) {
    const reason = "Giorno rischedulato dal piano ferie: verrà ricollocato su un'altra data";
    try {
      await notifyLeaveCancellation({
        employeeChatId: leave.employee.telegramChatId,
        previousStatus: "APPROVED",
        startDate: leave.startDate,
        endDate: leave.endDate,
        reason,
      });
    } catch (err) {
      console.error("[predictor/reschedule] notifyLeaveCancellation failed:", err);
    }
    if (leave.employee.email) {
      try {
        const reply = leaveCancellationNotification({
          previousStatus: "APPROVED",
          startDate: leave.startDate,
          endDate: leave.endDate,
          employeeName: leave.employee.displayName || leave.employee.name,
          reason,
        });
        await sendMail({ to: leave.employee.email, subject: reply.subject, text: reply.text, html: reply.html });
      } catch (err) {
        console.error("[predictor/reschedule] sendMail cancellation failed:", err);
      }
    }
  }

  // Bus event so other admin sessions (plan page listens on LEAVE*) refresh.
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
    console.error("[predictor/reschedule] bus publish failed:", err);
  }

  return NextResponse.json({ excludedDate: leave.startDate, ...result });
}
