"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CalendarPlus, LogIn, LogOut, Pause, Play } from "lucide-react";
import { useNotificationsContext } from "./NotificationsProvider";
import { ACTION_LABELS, type NotificationAction } from "@/lib/useNotifications";

function actionIcon(action: NotificationAction) {
  switch (action) {
    case "ENTRY":
      return <LogIn className="h-3.5 w-3.5 text-emerald-600" />;
    case "EXIT":
      return <LogOut className="h-3.5 w-3.5 text-rose-600" />;
    case "PAUSE_START":
      return <Pause className="h-3.5 w-3.5 text-amber-600" />;
    case "PAUSE_END":
      return <Play className="h-3.5 w-3.5 text-blue-600" />;
    case "LEAVE_PENDING":
      return <CalendarPlus className="h-3.5 w-3.5 text-primary" />;
  }
}

function relativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 30) return "ora";
  if (diffSec < 60) return `${diffSec}s fa`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.floor(m / 60);
  return `${h}h fa`;
}

export function NotificationBell() {
  const { events, unread, markAllRead } = useNotificationsContext();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Tick per aggiornare i "relativeTime" ogni 30s mentre il pannello e' aperto
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [open]);

  // Click outside per chiudere
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (next) markAllRead();
      return next;
    });
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="relative rounded-full p-2 text-on-surface-variant hover:bg-surface-container"
        aria-label="Notifiche"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-0 top-0 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-surface">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg bg-surface-container-lowest shadow-elevated">
          <div className="border-b border-surface-container px-4 py-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-on-surface">Notifiche in tempo reale</h3>
              <span className="text-[11px] text-on-surface-variant">{events.length} eventi</span>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {events.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-on-surface-variant">
                Nessuna notifica nelle ultime ore.
              </div>
            ) : (
              <ul>
                {events.map((evt) => (
                  <li
                    key={evt.id}
                    className="flex items-start gap-2 border-b border-surface-container px-4 py-2.5 last:border-b-0"
                  >
                    <div className="mt-0.5">{actionIcon(evt.action)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-on-surface">
                        <span className="font-semibold">{evt.employeeName}</span>{" "}
                        <span className="text-on-surface-variant">
                          {evt.action === "LEAVE_PENDING"
                            ? `ha richiesto ${evt.time}`
                            : ACTION_LABELS[evt.action]}
                        </span>
                      </div>
                      <div className="text-[11px] text-on-surface-variant">
                        {evt.action === "LEAVE_PENDING"
                          ? `${evt.date} — ${relativeTime(evt.ts)}`
                          : `${evt.time} — ${relativeTime(evt.ts)}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
