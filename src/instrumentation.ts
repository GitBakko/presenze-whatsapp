/**
 * Hook di Next.js per inizializzazioni a server start.
 *
 * Viene chiamato una sola volta quando il server Node parte (sia in
 * dev che in standalone). Lo usiamo per avviare il poller IMAP che
 * controlla periodicamente la casella ferie@... per nuove richieste.
 *
 * Nota: e' avvolto in `if (process.env.NEXT_RUNTIME === "nodejs")`
 * perche' Next chiama instrumentation anche per l'edge runtime, dove
 * il modulo IMAP non funzionerebbe.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Mail ingest poller (Graph API)
  const { ensureMailPollerStarted } = await import("./lib/mail-ingest");
  ensureMailPollerStarted();

  // WebSocket notification server (porta dedicata, bypassa IIS/ARR
  // che bufferizza SSE). Il client si connette direttamente a questa
  // porta senza passare dal reverse proxy.
  const { startWsNotificationServer } = await import("./lib/ws-notifications");
  startWsNotificationServer();
}
