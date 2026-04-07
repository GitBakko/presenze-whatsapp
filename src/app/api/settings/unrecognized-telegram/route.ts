import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

/**
 * Lista chat Telegram che hanno scritto al bot ma non sono associate a
 * nessun dipendente. Usata dalla pagina admin /settings/telegram per
 * collegare un chat a un employee o ignorarlo.
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const items = await prisma.unrecognizedTelegramChat.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });

  return NextResponse.json(
    items.map((i) => ({
      id: i.id,
      chatId: i.chatId,
      username: i.username,
      firstName: i.firstName,
      lastName: i.lastName,
      firstSeenAt: i.firstSeenAt.toISOString(),
      lastSeenAt: i.lastSeenAt.toISOString(),
      attempts: i.attempts,
    }))
  );
}

export async function DELETE(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Parametro 'id' obbligatorio" }, { status: 400 });
  }
  try {
    await prisma.unrecognizedTelegramChat.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Chat non trovata" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
