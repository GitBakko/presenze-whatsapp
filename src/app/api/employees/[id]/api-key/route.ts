import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { randomBytes, createHash } from "crypto";

/**
 * CRUD per la EmployeeApiKey personale di un dipendente.
 * Auth: checkAuth (admin session).
 *
 * GET  → stato della chiave (esiste? attiva? createdAt?)
 * POST → genera una nuova chiave (se ne esiste gia' una, la rigenera)
 * PUT  → attiva/disattiva (body: { active: boolean })
 * DELETE → elimina la chiave
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const key = await prisma.employeeApiKey.findUnique({
    where: { employeeId: id },
  });

  if (!key) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    id: key.id,
    active: key.active,
    createdAt: key.createdAt.toISOString(),
  });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;

  // Verifica che il dipendente esista
  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  // Se esiste gia' una chiave, eliminala (rigenera)
  await prisma.employeeApiKey.deleteMany({ where: { employeeId: id } });

  // Genera nuova chiave
  const rawKey = randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const created = await prisma.employeeApiKey.create({
    data: { keyHash, employeeId: id },
  });

  // Restituisce il plaintext UNA sola volta
  return NextResponse.json(
    {
      id: created.id,
      key: rawKey,
      active: created.active,
      createdAt: created.createdAt.toISOString(),
    },
    { status: 201 }
  );
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();
  const { active } = body as { active: boolean };

  const key = await prisma.employeeApiKey.findUnique({
    where: { employeeId: id },
  });
  if (!key) {
    return NextResponse.json({ error: "Nessuna chiave trovata" }, { status: 404 });
  }

  const updated = await prisma.employeeApiKey.update({
    where: { id: key.id },
    data: { active: !!active },
  });

  return NextResponse.json({
    id: updated.id,
    active: updated.active,
    createdAt: updated.createdAt.toISOString(),
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  await prisma.employeeApiKey.deleteMany({ where: { employeeId: id } });

  return NextResponse.json({ ok: true });
}
