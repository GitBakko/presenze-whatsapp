import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/telegram-handlers";
import type { TelegramUpdate } from "@/lib/telegram-bot";

/**
 * POST /api/telegram/webhook/[secret]
 *
 * Endpoint pubblico chiamato da Telegram per ogni update (messaggi, comandi,
 * tap di bottoni). La sicurezza si basa su DUE controlli:
 *   1. Il path contiene un segreto (TELEGRAM_WEBHOOK_SECRET) che solo
 *      Telegram conosce — l'admin lo configura via /api/telegram/setup.
 *   2. Telegram invia anche l'header X-Telegram-Bot-Api-Secret-Token con
 *      lo stesso valore se passato a setWebhook(secret_token).
 *
 * Verifichiamo entrambi quando possibile (l'header e' presente solo se
 * setWebhook e' stato chiamato con secret_token, vedi /api/telegram/setup).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secret: string }> }
) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[telegram/webhook] TELEGRAM_WEBHOOK_SECRET non configurato");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const { secret } = await params;
  if (secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (headerSecret && headerSecret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // Telegram si aspetta una risposta veloce. Eseguiamo l'handler in modo
  // sincrono ma proteggiamo l'endpoint dagli errori imprevisti per evitare
  // che Telegram ci ritenti l'update all'infinito.
  try {
    await handleTelegramUpdate(update);
  } catch (err) {
    console.error("[telegram/webhook] handler error:", err);
    // 200 OK comunque per non far retry infinito a Telegram
  }

  return NextResponse.json({ ok: true });
}
