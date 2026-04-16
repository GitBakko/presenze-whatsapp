import { prisma } from "./db";
import { sendMail } from "./mail-send";
import { newPendingLeaveNotification } from "./mail-templates";
import { LEAVE_TYPES } from "./leaves";
import { notificationsBus } from "./notifications-bus";

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
