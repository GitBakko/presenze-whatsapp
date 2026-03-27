import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();
  const { type, declaredTime } = body as {
    type?: string;
    declaredTime?: string;
  };

  const VALID_TYPES = ["ENTRY", "EXIT", "PAUSE_START", "PAUSE_END", "OVERTIME_START", "OVERTIME_END"];
  if (type && !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `Tipo non valido. Valori ammessi: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  if (declaredTime && !/^\d{2}:\d{2}$/.test(declaredTime)) {
    return NextResponse.json({ error: "Formato orario non valido (HH:MM)" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (type) data.type = type;
  if (declaredTime) data.declaredTime = declaredTime;

  const record = await prisma.attendanceRecord.update({
    where: { id },
    data,
  });

  return NextResponse.json(record);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;

  await prisma.attendanceRecord.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
