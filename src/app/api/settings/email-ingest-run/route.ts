import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { runOnce, isMailIngestConfigured } from "@/lib/mail-ingest";

/**
 * POST /api/settings/email-ingest-run
 *
 * Lancia manualmente un ciclo di ingest IMAP. Utile per testare la
 * configurazione subito dopo aver impostato le env vars, o per forzare
 * un refresh senza aspettare il prossimo tick del poller.
 */
export async function POST() {
  const denied = await checkAuth();
  if (denied) return denied;

  if (!isMailIngestConfigured()) {
    return NextResponse.json(
      { error: "IMAP non configurato. Imposta MAIL_IMAP_HOST/USER/PASSWORD nelle env vars." },
      { status: 503 }
    );
  }

  try {
    const stats = await runOnce();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "errore sconosciuto";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
