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
    <div role="tablist" className="flex gap-1 rounded-lg bg-surface-container-high p-1">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          role="tab"
          aria-selected={value === p.value}
          onClick={() => onChange(p.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
            value === p.value
              ? "bg-surface-container-lowest text-primary shadow-sm"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
