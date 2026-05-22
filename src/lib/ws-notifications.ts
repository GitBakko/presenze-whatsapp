/**
 * Server WebSocket per le notifiche di timbratura / ferie in tempo reale.
 *
 * Ascolta su una porta dedicata (WS_PORT, default 3101) nello stesso
 * processo Node del server Next.js, condividendo il singleton
 * `notificationsBus`.
 *
 * Autenticazione: ogni connessione viene autenticata a partire dai
 * cookie della sessione NextAuth (vedi ws-auth.ts). Connessioni senza
 * session valida vengono chiuse con code 1008. Un dipendente autenticato
 * vede SOLO eventi che lo riguardano (self-events whitelistati),
 * mentre un admin vede tutti gli eventi.
 *
 * Perche' una porta separata e non un upgrade sulla stessa porta 3100:
 * Next.js standalone server.js non espone l'HTTP server per hookare
 * l'evento `upgrade`. Una porta dedicata funziona perfettamente in LAN
 * e bypassa IIS/ARR (che bufferizza SSE ma non serve per WS perche'
 * il client si connette direttamente al Node tramite il proxy IIS WS).
 *
 * Avviato da instrumentation.ts al boot del server.
 */

import { WebSocketServer, WebSocket } from "ws";
import {
  notificationsBus,
  EMPLOYEE_SELF_ACTIONS,
  type NotificationEvent,
} from "./notifications-bus";
import { authenticateWsRequest, type WsAuthUser } from "./ws-auth";
import { logger } from "./logger";
import {
  recordRunning,
  recordTick,
  recordWsConnection,
  recordWsListening,
  setStartedAt,
} from "./worker-metrics";

let _started = false;
const WORKER = "ws-notifications";

function shouldDeliverTo(evt: NotificationEvent, user: WsAuthUser): boolean {
  if (user.role === "ADMIN") return true;
  if (!user.employeeId) return false;
  if (evt.employeeId !== user.employeeId) return false;
  return EMPLOYEE_SELF_ACTIONS.has(evt.action);
}

export function startWsNotificationServer(): void {
  if (_started) return;
  _started = true;

  const port = parseInt(process.env.WS_PORT || "3101", 10);
  const host = process.env.WS_HOST ?? "127.0.0.1";
  const wss = new WebSocketServer({ port, host });

  setStartedAt(WORKER);
  recordRunning(WORKER, true);

  wss.on("listening", () => {
    recordWsListening(true);
    // Record a success tick so a later wss.on("error") tick doesn't leave the
    // worker in permanent "degraded" state (deriveStatus flags any error with
    // no prior success as degraded). Once the server is listening we consider
    // the boot phase healthy.
    recordTick(WORKER, { ok: true });
    logger.info({ worker: WORKER, host, port }, "WebSocket server listening");
  });

  wss.on("error", (err) => {
    logger.error({ worker: WORKER, err: String(err) }, "WebSocket server error");
    recordTick(WORKER, { ok: false, errorMessage: String(err) });
  });

  wss.on("close", () => {
    recordWsListening(false);
    recordRunning(WORKER, false);
  });

  wss.on("connection", async (ws, req) => {
    const user = await authenticateWsRequest(req);
    if (!user) {
      try {
        ws.close(1008, "unauthorized");
      } catch {
        // already closed
      }
      return;
    }

    recordWsConnection(1);

    // Catch-up: solo eventi che il ruolo può vedere
    const recent = notificationsBus
      .recent()
      .filter((e) => shouldDeliverTo(e, user));
    if (recent.length > 0) {
      try {
        ws.send(JSON.stringify({ type: "init", events: recent }));
      } catch {
        // client gia' disconnesso
      }
    }

    const unsubscribe = notificationsBus.subscribe((evt: NotificationEvent) => {
      if (!shouldDeliverTo(evt, user)) return;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "punch", event: evt }));
        } catch {
          // ignore, verra' pulito al close
        }
      }
    });

    ws.on("close", () => {
      unsubscribe();
      recordWsConnection(-1);
    });

    ws.on("error", () => {
      unsubscribe();
    });

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
