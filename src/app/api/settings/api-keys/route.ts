import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { randomBytes, createHash } from "crypto";

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, active: true, createdAt: true },
  });

  return NextResponse.json(keys);
}

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { name } = body as { name: string };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Nome obbligatorio" }, { status: 400 });
  }

  // Generate a random 32-byte key
  const rawKey = randomBytes(32).toString("hex");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const apiKey = await prisma.apiKey.create({
    data: { keyHash, name: name.trim() },
  });

  // Return the raw key ONLY on creation — it won't be retrievable later
  return NextResponse.json({
    id: apiKey.id,
    name: apiKey.name,
    key: rawKey,
    message: "Salva questa chiave, non sarà più visibile.",
  }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID obbligatorio" }, { status: 400 });
  }

  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key) {
    return NextResponse.json({ error: "Chiave API non trovata" }, { status: 404 });
  }

  await prisma.apiKey.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
