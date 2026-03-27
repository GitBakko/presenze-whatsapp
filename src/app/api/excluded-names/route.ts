import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;
  const names = await prisma.excludedName.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(names);
}

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { name } = body as { name: string };

  const trimmed = name.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Nome richiesto" }, { status: 400 });
  }

  if (trimmed.length > 255) {
    return NextResponse.json({ error: "Nome troppo lungo (max 255 caratteri)" }, { status: 400 });
  }

  const existing = await prisma.excludedName.findUnique({ where: { name: trimmed } });
  if (existing) {
    return NextResponse.json({ error: "Nome già escluso" }, { status: 409 });
  }

  const created = await prisma.excludedName.create({ data: { name: trimmed } });
  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "ID richiesto" }, { status: 400 });
  }

  await prisma.excludedName.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
