"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { Toaster } from "sonner";
import { Sidebar } from "./Sidebar";
import { Menu, PanelLeftClose, LogOut, User, ChevronDown } from "lucide-react";
import { NotificationsProvider } from "./NotificationsProvider";
import { NotificationBell } from "./NotificationBell";
import { NotificationToast } from "./NotificationToast";
import { ConfirmProvider } from "./ConfirmProvider";

const AVATAR_COLORS = [
  "from-blue-500 to-blue-600",
  "from-emerald-500 to-emerald-600",
  "from-violet-500 to-violet-600",
  "from-amber-500 to-amber-600",
  "from-rose-500 to-rose-600",
  "from-indigo-500 to-indigo-600",
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { data: session } = useSession();

  const userName = session?.user?.name ?? "Utente";
  const userEmail = session?.user?.email ?? "";
  const userRole = (session?.user as { role?: string } | undefined)?.role ?? "EMPLOYEE";
  const userEmployeeId = (session?.user as { employeeId?: string | null } | undefined)?.employeeId ?? null;
  const initials = userName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const colorIdx = hashName(userName) % AVATAR_COLORS.length;

  // User dropdown
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [userMenuOpen]);

  return (
    <ConfirmProvider>
    <NotificationsProvider>
    <Toaster
      position="top-center"
      richColors
      closeButton
      toastOptions={{ duration: 4000 }}
    />
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
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell />

            {/* User dropdown */}
            <div ref={menuRef} className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 rounded-full px-2 py-1.5 transition-colors hover:bg-surface-container-low"
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_COLORS[colorIdx]} text-xs font-bold text-white`}
                >
                  {initials}
                </div>
                <span className="hidden text-sm font-medium text-on-surface sm:inline">
                  {userName}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-on-surface-variant" />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl bg-white shadow-elevated ring-1 ring-surface-container">
                  <div className="border-b border-surface-container px-4 py-3">
                    <p className="text-sm font-semibold text-on-surface">{userName}</p>
                    <p className="text-xs text-on-surface-variant">{userEmail}</p>
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      userRole === "ADMIN"
                        ? "bg-violet-100 text-violet-800"
                        : "bg-blue-100 text-blue-800"
                    }`}>
                      {userRole === "ADMIN" ? "Amministratore" : "Dipendente"}
                    </span>
                  </div>
                  <div className="p-1">
                    {userEmployeeId && (
                      <Link
                        href={`/employees/${userEmployeeId}/edit`}
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-on-surface hover:bg-surface-container-low"
                      >
                        <User className="h-4 w-4 text-on-surface-variant" />
                        Il mio profilo
                      </Link>
                    )}
                    <button
                      onClick={() => signOut({ callbackUrl: "/login" })}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                    >
                      <LogOut className="h-4 w-4" />
                      Esci
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="px-4 pb-12 pt-24 sm:px-8">{children}</div>
      </main>
      <NotificationToast />
    </div>
    </NotificationsProvider>
    </ConfirmProvider>
  );
}
