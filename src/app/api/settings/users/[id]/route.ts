import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: { employee: { select: { id: true, name: true, displayName: true } } },
  });
  if (!user) return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    employeeId: user.employeeId,
    employeeName: user.employee?.displayName ?? user.employee?.name ?? null,
    receiveLeaveNotifications: user.receiveLeaveNotifications,
    receiveMonthlyReport: user.receiveMonthlyReport,
    createdAt: user.createdAt.toISOString(),
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });

  const body = await request.json();
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if (typeof body.email === "string" && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Formato email non valido" }, { status: 400 });
    }
    const existing = await prisma.user.findFirst({ where: { email, id: { not: id } } });
    if (existing) return NextResponse.json({ error: "Email già in uso da un altro utente" }, { status: 409 });
    data.email = email;
  }
  if (typeof body.role === "string" && ["ADMIN", "EMPLOYEE"].includes(body.role)) {
    data.role = body.role;
  }
  if ("employeeId" in body) {
    const newEmpId = body.employeeId as string | null;
    if (newEmpId) {
      const emp = await prisma.employee.findUnique({ where: { id: newEmpId } });
      if (!emp) return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
      const linked = await prisma.user.findFirst({ where: { employeeId: newEmpId, id: { not: id } } });
      if (linked) return NextResponse.json({ error: `Dipendente già associato a ${linked.name}` }, { status: 409 });
    }
    data.employeeId = newEmpId ?? null;
  }
  if (typeof body.receiveLeaveNotifications === "boolean") {
    data.receiveLeaveNotifications = body.receiveLeaveNotifications;
  }
  if (typeof body.receiveMonthlyReport === "boolean") {
    data.receiveMonthlyReport = body.receiveMonthlyReport;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nessun campo da aggiornare" }, { status: 400 });
  }

  const updated = await prisma.user.update({ where: { id }, data });
  return NextResponse.json({ ok: true, name: updated.name, email: updated.email });
}
