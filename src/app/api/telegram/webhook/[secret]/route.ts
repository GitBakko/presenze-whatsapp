import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/telegram-handlers";
import { constantTimeEquals } from "@/lib/crypto-utils";
import type { TelegramUpdate } from "@/lib/telegram-bot";

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
  if (!constantTimeEquals(secret, expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Strict header mode: Telegram MUST send the secret_token header.
  // setWebhook is configured with secret_token (see /api/telegram/setup).
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!headerSecret || !constantTimeEquals(headerSecret, expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    await handleTelegramUpdate(update);
  } catch (err) {
    console.error("[telegram/webhook] handler error:", err);
  }

  return NextResponse.json({ ok: true });
}
