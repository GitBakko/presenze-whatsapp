import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { checkAuth } from "@/lib/auth-guard";
import { planTermination, type TerminationReason } from "@/lib/employees/termination";

/**
 * POST /api/employees/[id]/termination — termina (soft) un dipendente.
 * Body JSON: { terminationDate: "YYYY-MM-DD", reason: "RESIGNATION"|"DISMISSAL"|"OTHER", note?: string }
 * Libera nfcUid + telegramChatId, scrive i 4 campi di cessazione.
 *
 * DELETE /api/employees/[id]/termination — riattiva (annulla la cessazione).
 * La tessera/chat liberate vanno riassegnate manualmente.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const session = await auth();
  const actorUserId = session?.user?.id;
  if (!actorUserId) {
    return NextResponse.json({ error: "Sessione non valida" }, { status: 401 });
  }

  let body: { terminationDate?: unknown; reason?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, hireDate: true, nfcUid: true, telegramChatId: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  const leaves = await prisma.leaveRequest.findMany({
    where: { employeeId: id, status: { in: ["APPROVED", "PENDING"] } },
    select: { status: true, startDate: true, endDate: true },
  });

  let plan;
  try {
    plan = planTermination(
      employee,
      {
        terminationDate: String(body.terminationDate ?? ""),
        reason: body.reason as TerminationReason,
        note: typeof body.note === "string" ? body.note : undefined,
      },
      actorUserId,
      new Date(),
      leaves,
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dati non validi" }, { status: 400 });
  }

  const updated = await prisma.employee.update({
    where: { id },
    data: plan.updateData,
    select: { id: true, terminationDate: true, terminationReason: true },
  });

  return NextResponse.json({
    ok: true,
    id: updated.id,
    terminationDate: updated.terminationDate,
    terminationReason: updated.terminationReason,
    warnings: plan.warnings,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  await prisma.employee.update({
    where: { id },
    data: {
      terminationDate: null,
      terminationReason: null,
      terminatedById: null,
      terminatedAt: null,
    } satisfies Prisma.EmployeeUncheckedUpdateInput,
  });

  return NextResponse.json({ ok: true });
}
