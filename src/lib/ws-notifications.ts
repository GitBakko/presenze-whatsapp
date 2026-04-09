/**
 * Server WebSocket per le notifiche di timbratura in tempo reale.
 *
 * Ascolta su una porta dedicata (WS_PORT, default 3101) nello stesso
 * processo Node del server Next.js, condividendo il singleton
 * `notificationsBus`. Ogni client WebSocket riceve:
 *   - all'apertura: tutti gli eventi recenti dal buffer (catch-up)
 *   - in tempo reale: ogni nuovo evento pubblicato sul bus
 *
 * Perche' una porta separata e non un upgrade sulla stessa porta 3100:
 * Next.js standalone server.js non espone l'HTTP server per hookare
 * l'evento `upgrade`. Una porta dedicata funziona perfettamente in LAN
 * e bypassa IIS/ARR (che bufferizza SSE ma non serve per WS perche'
 * il client si connette direttamente al Node).
 *
 * Sicurezza: il canale e' read-only e trasmette solo nome dipendente +
 * tipo timbratura + orario. In un deploy LAN-only il rischio e' nullo.
 * Se in futuro servisse auth, il client potrebbe mandare il JWT come
 * primo messaggio e il server verificarlo prima di sottoscrivere.
 *
 * Avviato da instrumentation.ts al boot del server.
 */

import { WebSocketServer, WebSocket } from "ws";
import {
  notificationsBus,
  type NotificationEvent,
} from "./notifications-bus";

let _started = false;

export function startWsNotificationServer(): void {
  if (_started) return;
  _started = true;

  const port = parseInt(process.env.WS_PORT || "3101", 10);

  const wss = new WebSocketServer({ port, host: "0.0.0.0" });

  wss.on("listening", () => {
    console.log(`[ws-notifications] WebSocket server listening on port ${port}`);
  });

  wss.on("error", (err) => {
    console.error("[ws-notifications] WebSocket server error:", err);
  });

  wss.on("connection", (ws) => {
    // Manda gli eventi recenti come catch-up
    const recent = notificationsBus.recent();
    if (recent.length > 0) {
      try {
        ws.send(
          JSON.stringify({ type: "init", events: recent })
        );
      } catch {
        // client gia' disconnesso
      }
    }

    // Registra il subscriber per i nuovi eventi
    const unsubscribe = notificationsBus.subscribe(
      (evt: NotificationEvent) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "punch", event: evt }));
          } catch {
            // ignore, verra' pulito al close
          }
        }
      }
    );

    ws.on("close", () => {
      unsubscribe();
    });

    ws.on("error", () => {
      unsubscribe();
    });

    // Il client non manda messaggi (canale read-only), ma gestiamo
    // un eventuale ping/pong per keep-alive
    ws.on("pong", () => {
      // alive
    });
  });

  // Keep-alive: ping ogni 30s per rilevare client morti
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });
}
