import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth, checkAuthAny, isAuthUser } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;
  const { searchParams } = new URL(request.url);

  // Dipendenti vedono solo i propri record
  let employeeId = searchParams.get("employeeId");
  if (authResult.role === "EMPLOYEE") {
    employeeId = authResult.employeeId;
  }
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const type = searchParams.get("type");
  const source = searchParams.get("source");
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (date && !dateRegex.test(date)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }
  if (from && !dateRegex.test(from)) {
    return NextResponse.json({ error: "Formato 'from' non valido (YYYY-MM-DD)" }, { status: 400 });
  }
  if (to && !dateRegex.test(to)) {
    return NextResponse.json({ error: "Formato 'to' non valido (YYYY-MM-DD)" }, { status: 400 });
  }

  const where: Record<string, unknown> = {};
  if (employeeId) where.employeeId = employeeId;
  if (date) {
    where.date = date;
  } else if (from && to) {
    where.date = { gte: from, lte: to };
  } else if (from) {
    where.date = { gte: from };
  } else if (to) {
    where.date = { lte: to };
  }
  if (type) where.type = type;
  if (source) where.source = source;

  const limit = Math.min(Math.max(parseInt(limitParam || "0", 10) || 0, 0), 500);
  const offset = Math.max(parseInt(offsetParam || "0", 10) || 0, 0);

  const [total, records] = await Promise.all([
    limit > 0 ? prisma.attendanceRecord.count({ where }) : Promise.resolve(0),
    prisma.attendanceRecord.findMany({
      where,
      include: { employee: true },
      orderBy: [{ date: "desc" }, { declaredTime: "desc" }],
      ...(limit > 0 ? { take: limit, skip: offset } : {}),
    }),
  ]);

  const items = records.map((r) => ({
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
  }));

  // Backward-compat: when no `limit` is requested, the route used to return
  // a plain array. Keep that shape so existing callers (employees/[id]) don't
  // break. With `limit`, return an envelope with `total` for pagination.
  if (limit === 0) {
    return NextResponse.json(items);
  }
  return NextResponse.json({ items, total, limit, offset });
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
