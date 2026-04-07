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
 * Hook che mantiene una connessione SSE persistente a /api/notifications/stream
 * e accumula gli eventi ricevuti. Espone:
 *  - events: lista dei piu' recenti (max MAX_LIST), dal piu' nuovo al piu' vecchio
 *  - unread: contatore eventi non letti
 *  - markAllRead(): azzera il contatore
 *  - lastEvent: il piu' recente, utile per i toast
 *
 * Reconnect automatico con backoff esponenziale (1s -> 30s).
 */
export function useNotifications() {
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [lastEvent, setLastEvent] = useState<NotificationEvent | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(1000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ingest = useCallback((evt: NotificationEvent, isLive: boolean) => {
    if (seenIds.current.has(evt.id)) return;
    seenIds.current.add(evt.id);
    setEvents((prev) => {
      const next = [evt, ...prev].slice(0, MAX_LIST);
      return next;
    });
    if (isLive) {
      setUnread((c) => c + 1);
      setLastEvent(evt);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const es = new EventSource("/api/notifications/stream");
      esRef.current = es;

      es.addEventListener("init", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as { events: NotificationEvent[] };
          // gli eventi del buffer non incrementano "unread"
          for (const evt of data.events) ingest(evt, false);
          retryRef.current = 1000; // reset backoff
        } catch {
          // ignore
        }
      });

      es.addEventListener("punch", (e) => {
        try {
          const evt = JSON.parse((e as MessageEvent).data) as NotificationEvent;
          ingest(evt, true);
        } catch {
          // ignore
        }
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (cancelled) return;
        // backoff esponenziale, max 30s
        const wait = Math.min(retryRef.current, 30000);
        retryRef.current = Math.min(retryRef.current * 2, 30000);
        reconnectTimer.current = setTimeout(connect, wait);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
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
