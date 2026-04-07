import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import { validateApiKey } from "@/lib/api-key-auth";

export async function POST(request: NextRequest) {
  const isValid = await validateApiKey(request);
  if (!isValid) {
    return NextResponse.json({ error: "API key non valida" }, { status: 401 });
  }

  const body = await request.json();
  const { employeeId, employeeName, type, startDate, endDate, hours, timeSlots, sickProtocol, notes } = body as {
    employeeId?: string;
    employeeName?: string;
    type: string;
    startDate: string;
    endDate: string;
    hours?: number;
    timeSlots?: { from: string; to: string }[];
    sickProtocol?: string;
    notes?: string;
  };

  if (!type || !startDate || !endDate) {
    return NextResponse.json(
      { error: "Campi obbligatori: type, startDate, endDate + (employeeId o employeeName)" },
      { status: 400 }
    );
  }

  if (!(type in LEAVE_TYPES)) {
    return NextResponse.json({ error: "Tipo permesso non valido" }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }

  // Find employee by ID or name
  let employee;
  if (employeeId) {
    employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  } else if (employeeName) {
    employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { name: employeeName },
          { displayName: employeeName },
        ],
      },
    });
  }

  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  // External requests → PENDING approval
  const leave = await prisma.leaveRequest.create({
    data: {
      employeeId: employee.id,
      type,
      startDate,
      endDate,
      hours: hours ?? null,
      timeSlots: timeSlots ? JSON.stringify(timeSlots) : null,
      sickProtocol: sickProtocol ?? null,
      notes: notes ?? null,
      status: "PENDING",
      source: "EXTERNAL_API",
    },
  });

  return NextResponse.json({
    id: leave.id,
    employeeId: leave.employeeId,
    type: leave.type,
    typeLabel: LEAVE_TYPES[leave.type as LeaveType]?.label ?? leave.type,
    startDate: leave.startDate,
    endDate: leave.endDate,
    status: leave.status,
    message: "Richiesta creata con stato PENDING. Un amministratore deve approvarla.",
  }, { status: 201 });
}
