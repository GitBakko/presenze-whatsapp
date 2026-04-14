"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  AlertTriangle,
  FileBarChart,
  Clock,
  Settings,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  color: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, color: "text-blue-500" },
  { href: "/employees", label: "Dipendenti", icon: Users, color: "text-indigo-500", adminOnly: true },
  { href: "/records", label: "Timbrature", icon: Clock, color: "text-teal-500" },
  { href: "/leaves", label: "Ferie & Permessi", icon: CalendarCheck, color: "text-emerald-500" },
  { href: "/anomalies", label: "Anomalie", icon: AlertTriangle, color: "text-amber-500", adminOnly: true },
  { href: "/reports", label: "Report", icon: FileBarChart, color: "text-violet-500", adminOnly: true },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose: _onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "EMPLOYEE";
  const isAdmin = role === "ADMIN";
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
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="ePartner HR" className="h-8" />
          <div>
            <span className="font-display text-base font-extrabold tracking-tight text-primary">
              ePartner <span className="text-primary-container">HR</span>
            </span>
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant">
              Gestione Presenze
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3">
        {navItems.filter((item) => !item.adminOnly || isAdmin).map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
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
        {isAdmin && (
          <Link
            href="/settings"
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            className={`flex items-center gap-3 px-4 py-3 transition-colors duration-200 ${
              pathname.startsWith("/settings")
                ? "border-r-4 border-primary-container bg-surface-container-low font-bold text-primary"
                : "text-on-surface-variant hover:text-primary-container"
            }`}
          >
            <Settings className={`h-5 w-5 ${pathname.startsWith("/settings") ? "" : "text-outline-variant"}`} strokeWidth={1.75} />
            <span className="text-xs uppercase tracking-wider">Impostazioni</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
