import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

/**
 * Lista UID NFC letti dal kiosk ma non ancora associati a nessun dipendente.
 * Usato dalla pagina admin /settings/nfc per associare le tessere o ignorarle.
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const items = await prisma.unrecognizedNfc.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });

  return NextResponse.json(
    items.map((i) => ({
      id: i.id,
      uid: i.uid,
      firstSeenAt: i.firstSeenAt.toISOString(),
      lastSeenAt: i.lastSeenAt.toISOString(),
      attempts: i.attempts,
      notes: i.notes,
    }))
  );
}

/** Rimuove un UID non riconosciuto (dopo associazione manuale o "ignora"). */
export async function DELETE(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Parametro 'id' obbligatorio" }, { status: 400 });
  }

  try {
    await prisma.unrecognizedNfc.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "UID non trovato" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
