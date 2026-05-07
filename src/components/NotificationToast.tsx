"use client";

import { useEffect, useRef, useState } from "react";
import {
  Ban,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  LogIn,
  LogOut,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useNotificationsContext } from "./NotificationsProvider";
import { ACTION_LABELS, type NotificationEvent, type NotificationAction } from "@/lib/useNotifications";

const TOAST_DURATION_MS = 5000;

interface ToastEntry {
  evt: NotificationEvent;
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
    case "LEAVE_PENDING":
      return <CalendarClock className={`${cls} text-info`} />;
    case "LEAVE_APPROVED":
      return <CalendarCheck className={`${cls} text-success`} />;
    case "LEAVE_REJECTED":
      return <CalendarX className={`${cls} text-error`} />;
    case "LEAVE_CANCELLED":
      return <Ban className={`${cls} text-on-surface-variant`} />;
    case "RECORD_CREATED":
      return <Plus className={`${cls} text-success`} />;
    case "RECORD_UPDATED":
      return <Pencil className={`${cls} text-warning`} />;
    case "RECORD_DELETED":
      return <Trash2 className={`${cls} text-error`} />;
  }
}

function colorClasses(action: NotificationAction): string {
  switch (action) {
    case "ENTRY":
    case "LEAVE_APPROVED":
    case "RECORD_CREATED":
      return "border-success/30 bg-success-container/60 text-success";
    case "EXIT":
    case "LEAVE_REJECTED":
    case "RECORD_DELETED":
      return "border-error/30 bg-error-container text-on-error-container";
    case "PAUSE_START":
    case "RECORD_UPDATED":
      return "border-warning/40 bg-warning-container/60 text-warning";
    case "PAUSE_END":
      return "border-primary/30 bg-primary-container/30 text-on-primary-container";
    case "LEAVE_PENDING":
      return "border-info/30 bg-info-container/60 text-info";
    case "LEAVE_CANCELLED":
      return "border-outline-variant/40 bg-surface-container text-on-surface-variant";
    case "ANOMALY_RESOLVED":
    default:
      return "border-outline-variant/40 bg-surface-container text-on-surface-variant";
  }
}

/**
 * Testo del toast. Se l'evento riguarda la richiesta dell'utente stesso
 * (self-event) riscriviamo in prima persona — è più chiaro per il
 * dipendente vedere "La tua richiesta ferie è stata approvata" invece di
 * "Mario Rossi richiesta approvata".
 */
function headline(evt: NotificationEvent, isSelf: boolean): { subject: string; verb: string } {
  if (isSelf) {
    switch (evt.action) {
      case "LEAVE_APPROVED":
        return { subject: "La tua richiesta", verb: `${evt.time} è stata approvata` };
      case "LEAVE_REJECTED":
        return { subject: "La tua richiesta", verb: `${evt.time} è stata rifiutata` };
      case "LEAVE_CANCELLED":
        return { subject: "La tua richiesta", verb: `${evt.time} è stata annullata` };
    }
  }
  return { subject: evt.employeeName, verb: ACTION_LABELS[evt.action] };
}

function ToastItem({
  toastEntry,
  isSelf,
  onDismiss,
}: {
  toastEntry: ToastEntry;
  isSelf: boolean;
  onDismiss: (key: string) => void;
}) {
  const { evt, key } = toastEntry;
  const [visible, setVisible] = useState(false);
  const rafRef = useRef<number | null>(null);
  const { subject, verb } = headline(evt, isSelf);

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
          <span className="font-semibold">{subject}</span>{" "}
          <span className="text-on-surface-variant">{verb}</span>
        </div>
        <div className="text-[11px] text-on-surface-variant">
          {evt.action.startsWith("LEAVE_") ? evt.date : `alle ${evt.time}`}
        </div>
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
  const { data: session } = useSession();
  const myEmployeeId = (session?.user as { employeeId?: string | null } | undefined)?.employeeId ?? null;
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
        <ToastItem
          key={entry.key}
          toastEntry={entry}
          isSelf={!!myEmployeeId && entry.evt.employeeId === myEmployeeId}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}
