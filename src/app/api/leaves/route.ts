import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuthAny, isAuthUser, resolveEmployeeId } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import { notifyAdminsOfPendingLeave } from "@/lib/leave-notifications";

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
    const body = await request.json();

    let { employeeId } = body as { employeeId?: string };
    const { type, startDate, endDate, hours, timeSlots, sickProtocol, notes } = body as {
      type: string;
      startDate: string;
      endDate: string;
      hours?: number;
      timeSlots?: { from: string; to: string }[];
      sickProtocol?: string;
      notes?: string;
    };

    // Dipendenti possono creare solo per se stessi
    if (authResult.role === "EMPLOYEE") {
      employeeId = (await resolveEmployeeId(authResult)) ?? undefined;
    }

    if (!employeeId || !type || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Campi obbligatori: employeeId, type, startDate, endDate" },
        { status: 400 }
      );
    }

    if (!(type in LEAVE_TYPES)) {
      return NextResponse.json({ error: "Tipo permesso non valido" }, { status: 400 });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
    }

    if (startDate > endDate) {
      return NextResponse.json({ error: "La data di fine deve essere >= la data di inizio" }, { status: 400 });
    }

    // Verify employee exists
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
    }

    // Admin-created → auto-approved; employee-created → PENDING
    const isAdmin = authResult.role === "ADMIN";
    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId,
        type,
        startDate,
        endDate,
        hours: hours ?? null,
        timeSlots: timeSlots ? JSON.stringify(timeSlots) : null,
        sickProtocol: sickProtocol ?? null,
        notes: notes ?? null,
        status: isAdmin ? "APPROVED" : "PENDING",
        source: isAdmin ? "MANAGER" : "EXTERNAL_API",
        approvedById: isAdmin ? (session?.user?.id ?? null) : null,
        approvedAt: isAdmin ? new Date() : null,
      },
      include: { employee: true },
    });

    // Notify admins of pending leave (fire-and-forget)
    if (!isAdmin) {
      void notifyAdminsOfPendingLeave({
        employeeId: leave.employeeId,
        employeeName: leave.employee.displayName || leave.employee.name,
        type: leave.type,
        startDate: leave.startDate,
        endDate: leave.endDate,
        hours: leave.hours,
        notes: leave.notes,
      });
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
      status: leave.status,
      source: leave.source,
      createdAt: leave.createdAt.toISOString(),
    }, { status: 201 });
  } catch (err) {
    console.error("Leave creation error:", err);
    const message = err instanceof Error ? err.message : "Errore nella creazione della richiesta";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
