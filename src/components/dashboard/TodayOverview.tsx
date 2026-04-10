"use client";

import { Users, UserX, AlertTriangle } from "lucide-react";
import type { DashboardStatsResponse } from "@/types/dashboard";

export function TodayOverview({ data }: { data: DashboardStatsResponse["today"] }) {
  const cards = [
    {
      label: "Presenti oggi",
      value: data.presenti,
      sub: `su ${data.totalEmployees} dipendenti${data.ferie ? ` · ${data.ferie} in ferie` : ""}${data.malattia ? ` · ${data.malattia} malattia` : ""}`,
      color: "border-green-200 bg-green-50",
      textColor: "text-green-700",
      icon: Users,
      iconColor: "text-green-600",
    },
    {
      label: "Assenti",
      value: data.assenti,
      sub: "senza giustificazione",
      color: "border-red-200 bg-red-50",
      textColor: "text-red-700",
      icon: UserX,
      iconColor: "text-red-500",
    },
    {
      label: "Anomalie aperte",
      value: data.anomalieAperte,
      sub: "da verificare oggi",
      color: "border-amber-200 bg-amber-50",
      textColor: "text-amber-700",
      icon: AlertTriangle,
      iconColor: "text-amber-500",
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
            <p className="text-xs font-medium text-gray-600">{c.label}</p>
            <c.icon className={`h-5 w-5 ${c.iconColor}`} />
          </div>
          <p className={`mt-2 text-3xl font-bold ${c.textColor}`}>{c.value}</p>
          <p className="mt-1 text-xs text-gray-500">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}
