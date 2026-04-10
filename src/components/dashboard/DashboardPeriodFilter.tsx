"use client";

import type { DashboardPeriod } from "@/types/dashboard";

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: "today", label: "Oggi" },
  { value: "month", label: "Mese" },
  { value: "quarter", label: "Trimestre" },
];

export function DashboardPeriodFilter({
  value,
  onChange,
}: {
  value: DashboardPeriod;
  onChange: (p: DashboardPeriod) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
            value === p.value
              ? "bg-white text-primary shadow-sm"
              : "text-gray-500 hover:text-gray-800"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
