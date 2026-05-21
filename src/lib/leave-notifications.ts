import { prisma } from "./db";
import { sendMail } from "./mail-send";
import { newPendingLeaveNotification, leaveEditedNotification } from "./mail-templates";
import { LEAVE_TYPES } from "./leaves";
import { notificationsBus } from "./notifications-bus";
import { getTelegramBot } from "./telegram-bot";

export async function notifyAdminsOfPendingLeave(leave: {
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  notes: string | null;
}): Promise<void> {
  const typeLabel = (LEAVE_TYPES as Record<string, { label: string }>)[leave.type]?.label ?? leave.type;

  // 1. Email to opted-in admins
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", active: true, receiveLeaveNotifications: true },
      select: { email: true },
    });

    const template = newPendingLeaveNotification({
      employeeName: leave.employeeName,
      leaveTypeLabel: typeLabel,
      startDate: leave.startDate,
      endDate: leave.endDate,
      hours: leave.hours,
      notes: leave.notes,
    });

    for (const admin of admins) {
      if (admin.email) {
        void sendMail({
          to: admin.email,
          subject: template.subject,
          text: template.text,
          html: template.html,
        });
      }
    }
  } catch (err) {
    console.error("[leave-notifications] email failed:", err);
  }

  // 2. In-app notification via bus
  try {
    notificationsBus.publish({
      employeeId: leave.employeeId,
      employeeName: leave.employeeName,
      action: "LEAVE_PENDING",
      time: typeLabel,
      date: leave.startDate,
    });
  } catch (err) {
    console.error("[leave-notifications] bus publish failed:", err);
  }
}

export interface NotifyLeaveEditedArgs {
  employeeEmail: string | null;
  employeeName: string;
  employeeChatId: string | null;
  adminName: string;
  createdAt: string;
  diffBody: string;
  telegramBody: string;
  reason?: string | null;
  status: string;
}

/**
 * Notifica al dipendente quando un admin modifica una sua richiesta.
 * Best-effort: email + Telegram falliscono in silenzio (loggati).
 */
export async function notifyLeaveEdited(args: NotifyLeaveEditedArgs): Promise<void> {
  // Email (best-effort)
  if (args.employeeEmail) {
    try {
      const reply = leaveEditedNotification({
        employeeName: args.employeeName,
        adminName: args.adminName,
        createdAt: args.createdAt,
        diffBody: args.diffBody,
        reason: args.reason,
        status: args.status,
      });
      await sendMail({
        to: args.employeeEmail,
        subject: reply.subject,
        text: reply.text,
        html: reply.html,
      });
    } catch (err) {
      console.error("[notifyLeaveEdited] email failed:", err);
    }
  }

  // Telegram (best-effort). telegram-bot non espone un helper top-level:
  // usiamo direttamente getTelegramBot().sendMessage come fa telegram-handlers.
  if (args.employeeChatId) {
    const bot = getTelegramBot();
    if (bot) {
      try {
        await bot.sendMessage({
          chat_id: args.employeeChatId,
          text: args.telegramBody,
        });
      } catch (err) {
        console.error("[notifyLeaveEdited] telegram failed:", err);
      }
    }
  }
}
