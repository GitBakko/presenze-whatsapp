"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Menu, PanelLeftClose, Search, HelpCircle } from "lucide-react";
import { NotificationsProvider } from "./NotificationsProvider";
import { NotificationBell } from "./NotificationBell";
import { NotificationToast } from "./NotificationToast";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <NotificationsProvider>
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] transition-opacity lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main
        className={`min-h-screen flex-1 overflow-y-auto transition-[margin] duration-300 ease-editorial ${
          sidebarOpen ? "lg:ml-64" : "ml-0"
        }`}
      >
        {/* Glass topbar */}
        <header
          className={`fixed right-0 top-0 z-30 flex h-16 items-center justify-between border-b border-surface-container bg-white/80 px-4 shadow-glass backdrop-blur-xl transition-[width] duration-300 ease-editorial sm:px-8 ${
            sidebarOpen ? "lg:w-[calc(100%-16rem)]" : "w-full"
          }`}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
              aria-label={sidebarOpen ? "Chiudi sidebar" : "Apri sidebar"}
            >
              {sidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline-variant" />
              <input
                type="text"
                placeholder="Cerca..."
                className="w-64 rounded-lg border-0 bg-surface-container-low py-2 pl-10 pr-4 text-sm text-on-surface placeholder:text-outline-variant focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <button className="flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary">
              <HelpCircle className="h-5 w-5 text-blue-400" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <div className="px-4 pb-12 pt-24 sm:px-8">{children}</div>
      </main>
      <NotificationToast />
    </div>
    </NotificationsProvider>
  );
}
