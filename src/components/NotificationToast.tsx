"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, Pause, Play, X } from "lucide-react";
import { useNotificationsContext } from "./NotificationsProvider";
import { ACTION_LABELS, type NotificationEvent, type NotificationAction } from "@/lib/useNotifications";

const TOAST_DURATION_MS = 5000;

interface ToastEntry {
  evt: NotificationEvent;
  // monotonic id, perche' due eventi distinti col stesso id sono impossibili
  // ma il toast component vuole la sua chiave React stabile
  key: string;
}

function actionIcon(action: NotificationAction) {
  const cls = "h-4 w-4";
  switch (action) {
    case "ENTRY":
      return <LogIn className={`${cls} text-emerald-600`} />;
    case "EXIT":
      return <LogOut className={`${cls} text-rose-600`} />;
    case "PAUSE_START":
      return <Pause className={`${cls} text-amber-600`} />;
    case "PAUSE_END":
      return <Play className={`${cls} text-blue-600`} />;
  }
}

function colorClasses(action: NotificationAction): string {
  switch (action) {
    case "ENTRY":
      return "border-emerald-300 bg-emerald-50";
    case "EXIT":
      return "border-rose-300 bg-rose-50";
    case "PAUSE_START":
      return "border-amber-300 bg-amber-50";
    case "PAUSE_END":
      return "border-blue-300 bg-blue-50";
  }
}

export function NotificationToast() {
  const { lastEvent } = useNotificationsContext();
  const [stack, setStack] = useState<ToastEntry[]>([]);

  useEffect(() => {
    if (!lastEvent) return;
    const key = `${lastEvent.id}-${Date.now()}`;
    setStack((prev) => [...prev, { evt: lastEvent, key }]);
    const timer = setTimeout(() => {
      setStack((prev) => prev.filter((t) => t.key !== key));
    }, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [lastEvent]);

  const dismiss = (key: string) => {
    setStack((prev) => prev.filter((t) => t.key !== key));
  };

  if (stack.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {stack.map(({ evt, key }) => (
        <div
          key={key}
          className={`pointer-events-auto flex w-80 items-start gap-2 rounded-lg border px-3 py-2.5 shadow-elevated ${colorClasses(evt.action)}`}
        >
          <div className="mt-0.5">{actionIcon(evt.action)}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-on-surface">
              <span className="font-semibold">{evt.employeeName}</span>{" "}
              <span className="text-on-surface-variant">{ACTION_LABELS[evt.action]}</span>
            </div>
            <div className="text-[11px] text-on-surface-variant">alle {evt.time}</div>
          </div>
          <button
            type="button"
            onClick={() => dismiss(key)}
            className="rounded p-0.5 text-on-surface-variant hover:bg-black/5"
            aria-label="Chiudi"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
