"use client";

import { Users, UserX, AlertTriangle } from "lucide-react";
import type { DashboardStatsResponse } from "@/types/dashboard";

export function TodayOverview({ data }: { data: DashboardStatsResponse["today"] }) {
  const cards = [
    {
      label: "Presenti oggi",
      value: data.presenti,
      sub: `su ${data.totalEmployees} dipendenti${data.ferie ? ` · ${data.ferie} in ferie` : ""}${data.malattia ? ` · ${data.malattia} malattia` : ""}`,
      color: "border-success/30 bg-success-container/40",
      textColor: "text-success",
      icon: Users,
      iconColor: "text-success",
    },
    {
      label: "Assenti",
      value: data.assenti,
      sub: "senza giustificazione",
      color: "border-error/30 bg-error-container",
      textColor: "text-on-error-container",
      icon: UserX,
      iconColor: "text-error",
    },
    {
      label: "Anomalie aperte",
      value: data.anomalieAperte,
      sub: "da verificare oggi",
      color: "border-warning/40 bg-warning-container/40",
      textColor: "text-warning",
      icon: AlertTriangle,
      iconColor: "text-warning",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`rounded-xl border ${c.color} p-5`}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-on-surface-variant">{c.label}</p>
            <c.icon className={`h-5 w-5 ${c.iconColor}`} />
          </div>
          <p className={`mt-2 text-3xl font-bold ${c.textColor}`}>{c.value}</p>
          <p className="mt-1 text-xs text-on-surface-variant">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}
