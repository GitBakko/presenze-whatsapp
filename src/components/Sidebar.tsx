"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  Upload,
  AlertTriangle,
  FileBarChart,
  Settings,
  LogOut,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, color: "text-blue-500" },
  { href: "/employees", label: "Dipendenti", icon: Users, color: "text-indigo-500" },
  { href: "/leaves", label: "Ferie & Permessi", icon: CalendarCheck, color: "text-emerald-500" },
  { href: "/import", label: "Importa", icon: Upload, color: "text-cyan-500" },
  { href: "/anomalies", label: "Anomalie", icon: AlertTriangle, color: "text-amber-500" },
  { href: "/reports", label: "Report", icon: FileBarChart, color: "text-violet-500" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [pendingLeaves, setPendingLeaves] = useState(0);

  useEffect(() => {
    fetch("/api/leaves?status=PENDING")
      .then((r) => r.ok ? r.json() : [])
      .then((data: unknown[]) => setPendingLeaves(data.length))
      .catch(() => {});
  }, [pathname]);

  return (
    <aside
      className={`fixed left-0 top-0 z-50 flex h-screen w-64 flex-col bg-surface-container-low py-6 transition-transform duration-300 ease-editorial ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Brand */}
      <div className="mb-10 px-6">
        <h1 className="font-display text-xl font-extrabold tracking-tight text-primary">
          Presenze
        </h1>
        <p className="mt-1 text-xs uppercase tracking-wider text-on-surface-variant">
          HR Management
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 transition-colors duration-200 ${
                isActive
                  ? "border-r-4 border-primary-container bg-surface-container-low font-bold text-primary"
                  : "text-on-surface-variant hover:text-primary-container"
              }`}
            >
              <item.icon className={`h-5 w-5 ${isActive ? "" : item.color}`} strokeWidth={1.75} />
              <span className="text-xs uppercase tracking-wider">
                {item.label}
              </span>
              {item.href === "/leaves" && pendingLeaves > 0 && (
                <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-yellow-400 px-1 text-[10px] font-bold text-white">
                  {pendingLeaves}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-outline-variant/30 px-3 pt-6">
        <Link
          href="/settings"
          className={`flex items-center gap-3 px-4 py-3 transition-colors duration-200 ${
            pathname.startsWith("/settings")
              ? "border-r-4 border-primary-container bg-surface-container-low font-bold text-primary"
              : "text-on-surface-variant hover:text-primary-container"
          }`}
        >
          <Settings className={`h-5 w-5 ${pathname.startsWith("/settings") ? "" : "text-outline-variant"}`} strokeWidth={1.75} />
          <span className="text-xs uppercase tracking-wider">Impostazioni</span>
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 px-4 py-3 text-on-surface-variant transition-colors duration-200 hover:text-primary-container"
        >
          <LogOut className="h-5 w-5 text-rose-400" strokeWidth={1.75} />
          <span className="text-xs uppercase tracking-wider">Esci</span>
        </button>
      </div>
    </aside>
  );
}
