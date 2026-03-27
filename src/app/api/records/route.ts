import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");
  const date = searchParams.get("date");

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }

  const where: Record<string, unknown> = {};
  if (employeeId) where.employeeId = employeeId;
  if (date) where.date = date;

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: { employee: true },
    orderBy: [{ date: "desc" }, { declaredTime: "asc" }],
  });

  return NextResponse.json(records.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employee: r.employee.displayName || r.employee.name,
    date: r.date,
    type: r.type,
    declaredTime: r.declaredTime,
    messageTime: r.messageTime,
    rawMessage: r.rawMessage,
    source: r.source,
    isManual: r.isManual,
  })));
}

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { employeeId, date, type, declaredTime, rawMessage } = body as {
    employeeId: string;
    date: string;
    type: string;
    declaredTime: string;
    rawMessage?: string;
  };

  if (!employeeId || !date || !type || !declaredTime) {
    return NextResponse.json({ error: "Campi obbligatori: employeeId, date, type, declaredTime" }, { status: 400 });
  }

  const VALID_TYPES = ["ENTRY", "EXIT", "PAUSE_START", "PAUSE_END", "OVERTIME_START", "OVERTIME_END"];
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `Tipo non valido. Valori ammessi: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }

  if (!/^\d{2}:\d{2}$/.test(declaredTime)) {
    return NextResponse.json({ error: "Formato orario non valido (HH:MM)" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  const record = await prisma.attendanceRecord.create({
    data: {
      employeeId,
      date,
      type,
      declaredTime,
      messageTime: declaredTime,
      rawMessage: rawMessage ?? `[Manuale] ${type} ${declaredTime}`,
      source: "MANUAL",
      isManual: true,
    },
  });

  return NextResponse.json(record, { status: 201 });
}
