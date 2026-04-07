import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { notificationsBus, type NotificationEvent } from "@/lib/notifications-bus";

/**
 * GET /api/notifications/stream
 *
 * Server-Sent Events stream con le notifiche di timbratura in tempo reale.
 * Solo per admin loggati.
 *
 * Protocollo:
 *  - alla connessione invia un evento `init` con gli eventi recenti dal buffer
 *  - per ogni nuovo evento pubblicato sul bus invia un evento `punch`
 *  - ogni 25s manda un commento di keep-alive per evitare timeout di proxy
 */

// Forza Node runtime: necessario per stream long-lived (l'edge runtime
// di Next ha limiti di durata stretti).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseFormat(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // 1. snapshot iniziale degli eventi recenti
      const recent = notificationsBus.recent();
      safeEnqueue(sseFormat("init", { events: recent }));

      // 2. iscrizione al bus
      const unsubscribe = notificationsBus.subscribe((evt: NotificationEvent) => {
        safeEnqueue(sseFormat("punch", evt));
      });

      // 3. keep-alive ogni 25s (commento SSE)
      const keepAlive = setInterval(() => {
        safeEnqueue(`: keep-alive ${Date.now()}\n\n`);
      }, 25000);

      // 4. cleanup quando il client si disconnette
      const onAbort = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      request.signal.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
