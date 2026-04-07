"use client";

import { createContext, useContext, ReactNode } from "react";
import { useNotifications, type NotificationEvent } from "@/lib/useNotifications";

interface NotificationsContextValue {
  events: NotificationEvent[];
  unread: number;
  markAllRead: () => void;
  lastEvent: NotificationEvent | null;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * Provider che instaura UNA sola connessione SSE per tutta l'app e la
 * condivide tra NotificationBell e NotificationToast. Va piazzato il piu'
 * vicino possibile alla radice del layout autenticato (DashboardShell).
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const value = useNotifications();
  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsContext(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotificationsContext deve essere usato dentro NotificationsProvider");
  }
  return ctx;
}
