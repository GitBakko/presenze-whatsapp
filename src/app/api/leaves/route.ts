import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuthAny, isAuthUser, resolveEmployeeId } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import { createLeaveSchema } from "@/lib/leaves/validation";
import { checkOverlap } from "@/lib/leaves/overlap";
import { notifyAdminsOfPendingLeave } from "@/lib/leave-notifications";
import { notificationsBus } from "@/lib/notifications-bus";

export async function GET(request: NextRequest) {
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    let employeeId = searchParams.get("employeeId");

    // Dipendenti vedono solo le proprie richieste
    if (authResult.role === "EMPLOYEE") {
      employeeId = await resolveEmployeeId(authResult);
    }
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const where: Record<string, unknown> = {};
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (from && to) {
      where.startDate = { gte: from, lte: to };
    } else if (from) {
      where.startDate = { gte: from };
    } else if (to) {
      where.startDate = { lte: to };
    }

    const leaves = await prisma.leaveRequest.findMany({
      where,
      include: { employee: true, approvedBy: true },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });

    const result = leaves.map((l) => ({
      id: l.id,
      employeeId: l.employeeId,
      employeeName: l.employee.displayName || l.employee.name,
      type: l.type,
      typeLabel: LEAVE_TYPES[l.type as LeaveType]?.label ?? l.type,
      startDate: l.startDate,
      endDate: l.endDate,
      hours: l.hours,
      timeSlots: l.timeSlots ? JSON.parse(l.timeSlots) : null,
      sickProtocol: l.sickProtocol,
      notes: l.notes,
      status: l.status,
      source: l.source,
      createdAt: l.createdAt.toISOString(),
      approvedBy: l.approvedBy?.name ?? null,
      approvedAt: l.approvedAt?.toISOString() ?? null,
      version: l.version,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("Leaves GET error:", err);
    const message = err instanceof Error ? err.message : "Errore nel caricamento";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;

  try {
    const session = await auth();
    const rawBody = await request.json();

    let resolvedEmployeeId: string | undefined = rawBody.employeeId;
    if (authResult.role === "EMPLOYEE") {
      resolvedEmployeeId = (await resolveEmployeeId(authResult)) ?? undefined;
    }
    const bodyForValidation = { ...rawBody, employeeId: resolvedEmployeeId };

    const parsed = createLeaveSchema.safeParse(bodyForValidation);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const isAdmin = authResult.role === "ADMIN";

    const employee = await prisma.employee.findUnique({ where: { id: body.employeeId } });
    if (!employee) {
      return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
    }

    const overlap = await checkOverlap(body.employeeId, {
      type: body.type,
      startDate: body.startDate,
      endDate: body.endDate,
      hours: body.hours ?? null,
      timeSlots: body.timeSlots ? JSON.stringify(body.timeSlots) : null,
    });

    if (overlap.kind === "BLOCK") {
      return NextResponse.json(
        { error: "OVERLAP_BLOCK", conflicts: overlap.conflicts, reason: overlap.reason },
        { status: 409 }
      );
    }
    if (overlap.kind === "REQUIRES_CONFIRM" && !(isAdmin && body.confirmOverride)) {
      return NextResponse.json(
        { error: "OVERLAP_REQUIRES_CONFIRM", conflicts: overlap.conflicts },
        { status: 409 }
      );
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: body.employeeId,
        type: body.type,
        startDate: body.startDate,
        endDate: body.endDate,
        hours: body.hours ?? null,
        timeSlots: body.timeSlots ? JSON.stringify(body.timeSlots) : null,
        sickProtocol: body.sickProtocol ?? null,
        notes: body.notes ?? null,
        status: isAdmin ? "APPROVED" : "PENDING",
        source: isAdmin ? "MANAGER" : "EXTERNAL_API",
        approvedById: isAdmin ? (session?.user?.id ?? null) : null,
        approvedAt: isAdmin ? new Date() : null,
      },
      include: { employee: true },
    });

    const employeeName = leave.employee.displayName || leave.employee.name;
    const typeLabel = LEAVE_TYPES[leave.type as LeaveType]?.label ?? leave.type;

    if (!isAdmin) {
      void notifyAdminsOfPendingLeave({
        employeeId: leave.employeeId,
        employeeName,
        type: leave.type,
        startDate: leave.startDate,
        endDate: leave.endDate,
        hours: leave.hours,
        notes: leave.notes,
      });
    } else {
      try {
        notificationsBus.publish({
          employeeId: leave.employeeId,
          employeeName,
          action: "LEAVE_APPROVED",
          time: typeLabel,
          date: leave.startDate,
          details: {
            leaveId: leave.id,
            leaveType: leave.type,
            leaveStartDate: leave.startDate,
            leaveEndDate: leave.endDate,
          },
        });
      } catch (err) {
        console.error("[leaves/POST] bus publish failed:", err);
      }
    }

    return NextResponse.json({
      id: leave.id,
      employeeId: leave.employeeId,
      employeeName,
      type: leave.type,
      typeLabel,
      startDate: leave.startDate,
      endDate: leave.endDate,
      hours: leave.hours,
      status: leave.status,
      source: leave.source,
      createdAt: leave.createdAt.toISOString(),
      version: leave.version,
    }, { status: 201 });
  } catch (err) {
    console.error("Leave creation error:", err);
    const message = err instanceof Error ? err.message : "Errore nella creazione della richiesta";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
