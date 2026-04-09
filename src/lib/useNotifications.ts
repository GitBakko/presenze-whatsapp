"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type NotificationAction = "ENTRY" | "EXIT" | "PAUSE_START" | "PAUSE_END";

export interface NotificationEvent {
  id: string;
  ts: number;
  employeeId: string;
  employeeName: string;
  action: NotificationAction;
  time: string;
  date: string;
}

const MAX_LIST = 50;

/**
 * Hook che mantiene una connessione WebSocket al server di notifiche
 * (porta WS_PORT, default 3101) e accumula gli eventi ricevuti.
 *
 * Il WS server gira nello stesso processo Node di Next.js ma su una
 * porta dedicata, bypassando IIS/ARR (che bufferizza SSE). Il client
 * si connette direttamente al Node sulla porta 3101.
 *
 * Protocollo:
 *   - alla connessione il server manda { type:"init", events:[...] }
 *   - per ogni nuovo punch manda { type:"punch", event:{...} }
 *
 * Reconnect automatico con backoff esponenziale (1s -> 30s).
 */
export function useNotifications() {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [lastEvent, setLastEvent] = useState<NotificationEvent | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(1000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ingest = useCallback((evt: NotificationEvent, isLive: boolean) => {
    if (seenIds.current.has(evt.id)) return;
    seenIds.current.add(evt.id);
    setEvents((prev) => [evt, ...prev].slice(0, MAX_LIST));
    if (isLive) {
      setUnread((c) => c + 1);
      setLastEvent(evt);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      // Costruisci l'URL WebSocket: stessa hostname del browser, porta 3101
      const wsPort = 3101;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.hostname}:${wsPort}`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 1000; // reset backoff
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "init" && Array.isArray(data.events)) {
            for (const evt of data.events) ingest(evt, false);
          } else if (data.type === "punch" && data.event) {
            ingest(data.event, true);
          }
        } catch {
          // ignore malformed
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelled) scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose verra' chiamato dopo, gestisce il reconnect
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const wait = Math.min(retryRef.current, 30000);
      retryRef.current = Math.min(retryRef.current * 2, 30000);
      reconnectTimer.current = setTimeout(connect, wait);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [ingest]);

  const markAllRead = useCallback(() => setUnread(0), []);

  return { events, unread, markAllRead, lastEvent };
}

export const ACTION_LABELS: Record<NotificationAction, string> = {
  ENTRY: "è entrato",
  EXIT: "è uscito",
  PAUSE_START: "ha iniziato la pausa",
  PAUSE_END: "ha finito la pausa",
};
