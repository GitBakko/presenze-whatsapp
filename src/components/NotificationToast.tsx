"use client";

import { useEffect, useRef, useState } from "react";
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
      return <LogIn className={`${cls} text-success`} />;
    case "EXIT":
      return <LogOut className={`${cls} text-error`} />;
    case "PAUSE_START":
      return <Pause className={`${cls} text-warning`} />;
    case "PAUSE_END":
      return <Play className={`${cls} text-on-primary-container`} />;
  }
}

function colorClasses(action: NotificationAction): string {
  switch (action) {
    case "ENTRY":
      return "border-success/30 bg-success-container/60 text-success";
    case "EXIT":
      return "border-error/30 bg-error-container text-on-error-container";
    case "PAUSE_START":
      return "border-warning/40 bg-warning-container/60 text-warning";
    case "PAUSE_END":
      return "border-primary/30 bg-primary-container/30 text-on-primary-container";
  }
}

function ToastItem({
  toastEntry,
  onDismiss,
}: {
  toastEntry: ToastEntry;
  onDismiss: (key: string) => void;
}) {
  const { evt, key } = toastEntry;
  const [visible, setVisible] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(() => {
      setVisible(true);
    });
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`pointer-events-auto flex max-w-[calc(100vw-2rem)] w-80 items-start gap-2 rounded-lg border px-3 py-2.5 shadow-elevated transition-[transform,opacity] duration-200 ease-out ${colorClasses(evt.action)} ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
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
        onClick={() => onDismiss(key)}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-on-surface-variant hover:bg-black/5"
        aria-label="Chiudi"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
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
      {stack.map((entry) => (
        <ToastItem key={entry.key} toastEntry={entry} onDismiss={dismiss} />
      ))}
    </div>
  );
}
