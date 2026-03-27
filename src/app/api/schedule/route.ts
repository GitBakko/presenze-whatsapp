import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");

  const where: Record<string, unknown> = {};
  if (employeeId) where.employeeId = employeeId;

  const schedules = await prisma.employeeSchedule.findMany({
    where,
    include: { employee: true },
    orderBy: [{ employeeId: "asc" }, { dayOfWeek: "asc" }],
  });

  return NextResponse.json(schedules.map((s) => ({
    id: s.id,
    employeeId: s.employeeId,
    employee: s.employee.displayName || s.employee.name,
    dayOfWeek: s.dayOfWeek,
    block1Start: s.block1Start,
    block1End: s.block1End,
    block2Start: s.block2Start,
    block2End: s.block2End,
  })));
}

export async function PUT(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { employeeId, dayOfWeek, block1Start, block1End, block2Start, block2End } = body as {
    employeeId: string;
    dayOfWeek: number;
    block1Start: string | null;
    block1End: string | null;
    block2Start: string | null;
    block2End: string | null;
  };

  if (!employeeId || dayOfWeek == null) {
    return NextResponse.json({ error: "employeeId e dayOfWeek sono obbligatori" }, { status: 400 });
  }

  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
    return NextResponse.json({ error: "dayOfWeek deve essere un intero tra 1 e 7" }, { status: 400 });
  }

  const timeRegex = /^\d{2}:\d{2}$/;
  for (const [label, val] of [["block1Start", block1Start], ["block1End", block1End], ["block2Start", block2Start], ["block2End", block2End]] as const) {
    if (val !== null && !timeRegex.test(val)) {
      return NextResponse.json({ error: `Formato orario non valido per ${label} (HH:MM)` }, { status: 400 });
    }
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  const schedule = await prisma.employeeSchedule.upsert({
    where: { employeeId_dayOfWeek: { employeeId, dayOfWeek } },
    create: { employeeId, dayOfWeek, block1Start, block1End, block2Start, block2End },
    update: { block1Start, block1End, block2Start, block2End },
  });

  return NextResponse.json(schedule);
}
