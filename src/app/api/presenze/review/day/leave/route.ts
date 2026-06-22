// src/app/api/presenze/review/day/leave/route.ts
//
// Day-scoped leave editing for the Revisione Presenze popup. Add / edit / remove
// the leave covering ONE (employee, date) cell — splitting a multi-day request
// around the date when needed (see src/lib/leaves/day-edit.ts).
//
// Deliberately does NOT notify the employee (Telegram/email): these are admin
// data corrections on a (usually past) month, not new decisions. It only
// publishes on the in-memory bus so the open UI refreshes.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { notificationsBus } from "@/lib/notifications-bus";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import {
  applyDayLeaveOp,
  DayLeaveError,
  DAY_LEAVE_ERROR_STATUS,
  type DayLeaveOp,
} from "@/lib/leaves/day-edit";

const OPS: DayLeaveOp[] = ["removeDay", "editDay", "add"];
const LEAVE_TYPE_KEYS = Object.keys(LEAVE_TYPES);

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const session = await auth();
  const editorUserId = session?.user?.id;
  if (!editorUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const { op, employeeId, date, leaveId, type, hours, notes, reason } = body as {
    op?: string;
    employeeId?: string;
    date?: string;
    leaveId?: string;
    type?: string;
    hours?: number | null;
    notes?: string | null;
    reason?: string | null;
  };

  if (!op || !OPS.includes(op as DayLeaveOp)) {
    return NextResponse.json({ error: `op non valido (${OPS.join(", ")})` }, { status: 400 });
  }
  if (!employeeId || !date) {
    return NextResponse.json({ error: "Campi obbligatori: employeeId, date" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }
  if ((op === "removeDay" || op === "editDay") && !leaveId) {
    return NextResponse.json({ error: "leaveId obbligatorio" }, { status: 400 });
  }
  // Bound free-text the same way createLeaveSchema/editLeaveSchema do (notes ≤2000,
  // reason ≤500) — this route validates manually, so guard explicitly.
  if (notes != null && (typeof notes !== "string" || notes.length > 2000)) {
    return NextResponse.json({ error: "notes non valido (max 2000 caratteri)" }, { status: 400 });
  }
  if (reason != null && (typeof reason !== "string" || reason.length > 500)) {
    return NextResponse.json({ error: "reason non valido (max 500 caratteri)" }, { status: 400 });
  }

  let normalizedHours: number | null = null;
  if (op === "editDay" || op === "add") {
    if (!type || !LEAVE_TYPE_KEYS.includes(type)) {
      return NextResponse.json({ error: "Tipo assenza non valido" }, { status: 400 });
    }
    const unit = LEAVE_TYPES[type as LeaveType].unit;
    if (unit === "hours") {
      if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
        return NextResponse.json({ error: "Ore non valide (0 < ore ≤ 24)" }, { status: 400 });
      }
      normalizedHours = Math.round(hours * 100) / 100;
    } else {
      normalizedHours = null; // day-based types carry no hours
    }
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  let result;
  try {
    result = await applyDayLeaveOp({
      op: op as DayLeaveOp,
      employeeId,
      date,
      leaveId,
      type,
      hours: normalizedHours,
      notes: notes ?? null,
      editorUserId,
      reason: reason ?? null,
    });
  } catch (err) {
    if (err instanceof DayLeaveError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: DAY_LEAVE_ERROR_STATUS[err.code] ?? 500 },
      );
    }
    console.error("[review/day/leave] op failed:", err);
    return NextResponse.json({ error: "Operazione non riuscita" }, { status: 500 });
  }

  try {
    const action =
      op === "removeDay" ? "LEAVE_CANCELLED" : op === "add" ? "LEAVE_APPROVED" : "LEAVE_EDITED";
    notificationsBus.publish({
      employeeId,
      employeeName: employee.displayName || employee.name,
      action,
      time: type ? LEAVE_TYPES[type as LeaveType]?.label ?? type : "",
      date,
      details: { leaveType: type ?? undefined, leaveStartDate: date, leaveEndDate: date },
    });
  } catch (err) {
    console.error("[review/day/leave] bus publish failed:", err);
  }

  return NextResponse.json({ ok: true, ...result });
}
