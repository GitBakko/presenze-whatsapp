import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { getTelegramBot } from "@/lib/telegram-bot";

/**
 * POST /api/telegram/setup
 *
 * Endpoint amministrativo one-shot per registrare il webhook su Telegram.
 * Da chiamare manualmente dopo il deploy o quando cambia l'URL pubblico.
 *
 * Body opzionale: { publicUrl?: string }  — se non passato, usa NEXTAUTH_URL.
 *
 * Configura anche i comandi del bot (la lista che appare nel menu di Telegram).
 */
export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const bot = getTelegramBot();
  if (!bot) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN non configurato nelle env" },
      { status: 503 }
    );
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "TELEGRAM_WEBHOOK_SECRET non configurato nelle env" },
      { status: 503 }
    );
  }

  let publicUrl: string | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { publicUrl?: string };
    publicUrl = body.publicUrl;
  } catch {
    publicUrl = undefined;
  }
  if (!publicUrl) publicUrl = process.env.NEXTAUTH_URL;
  if (!publicUrl) {
    return NextResponse.json(
      { error: "Specifica publicUrl nel body o configura NEXTAUTH_URL" },
      { status: 400 }
    );
  }

  // Rimuovi slash finali
  publicUrl = publicUrl.replace(/\/+$/, "");
  const webhookUrl = `${publicUrl}/api/telegram/webhook/${secret}`;

  try {
    const me = await bot.getMe();
    await bot.setWebhook(webhookUrl, secret);
    await bot.setMyCommands([
      { command: "start", description: "Saluto e istruzioni" },
      { command: "help", description: "Lista comandi" },
      { command: "entrata", description: "Registra entrata" },
      { command: "uscita", description: "Registra uscita" },
      { command: "pausa", description: "Inizio pausa" },
      { command: "finepausa", description: "Fine pausa" },
      { command: "stato", description: "Stato corrente + ore di oggi" },
      { command: "storico", description: "Timbrature di oggi" },
      { command: "ferie", description: "Richiesta ferie (es. /ferie DAL 15/04 AL 18/04)" },
      { command: "permesso", description: "Richiesta permesso" },
    ]);
    return NextResponse.json({
      ok: true,
      bot: me,
      webhookUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "errore sconosciuto";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/telegram/setup
 * Rimuove il webhook (utile per test locali in cui poi si fa long polling).
 */
export async function DELETE() {
  const denied = await checkAuth();
  if (denied) return denied;

  const bot = getTelegramBot();
  if (!bot) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN non configurato" }, { status: 503 });
  }
  try {
    await bot.deleteWebhook();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "errore sconosciuto";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
