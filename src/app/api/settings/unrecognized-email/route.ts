import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

/**
 * Mittenti email non riconosciuti dall'ingest. Stesso pattern di
 * /api/settings/unrecognized-nfc e unrecognized-telegram.
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const items = await prisma.unrecognizedEmail.findMany({
    orderBy: { receivedAt: "desc" },
    take: 200,
  });

  return NextResponse.json(
    items.map((i) => ({
      id: i.id,
      fromAddress: i.fromAddress,
      subject: i.subject,
      snippet: i.snippet,
      receivedAt: i.receivedAt.toISOString(),
      attempts: i.attempts,
    }))
  );
}

export async function DELETE(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obbligatorio" }, { status: 400 });
  try {
    await prisma.unrecognizedEmail.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "non trovato" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
