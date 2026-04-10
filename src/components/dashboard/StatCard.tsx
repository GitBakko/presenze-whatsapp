"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { StatCardProps } from "@/types/dashboard";

const COLOR_MAP = {
  green: { bg: "bg-green-50", text: "text-green-700", bar: "bg-green-500" },
  blue: { bg: "bg-blue-50", text: "text-blue-700", bar: "bg-blue-500" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", bar: "bg-amber-500" },
  red: { bg: "bg-red-50", text: "text-red-700", bar: "bg-red-500" },
  gray: { bg: "bg-gray-50", text: "text-gray-500", bar: "bg-gray-400" },
};

export function StatCard({
  label,
  value,
  delta,
  deltaInverted = false,
  color,
  barPercent,
}: StatCardProps) {
  const c = COLOR_MAP[color];

  // Determina se il delta è "buono" o "cattivo"
  const isPositive = delta > 0;
  const isNegative = delta < 0;
  const isGood = deltaInverted ? isNegative : isPositive;
  const isBad = deltaInverted ? isPositive : isNegative;

  const deltaColor = isGood
    ? "text-green-600"
    : isBad
    ? "text-red-600"
    : "text-gray-400";

  const DeltaIcon = isPositive
    ? TrendingUp
    : isNegative
    ? TrendingDown
    : Minus;

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200/60 bg-white p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${c.text}`}>{value}</p>
      {delta !== 0 ? (
        <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${deltaColor}`}>
          <DeltaIcon className="h-3 w-3" />
          {delta > 0 ? "+" : ""}
          {delta}
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
          <Minus className="h-3 w-3" /> invariato
        </div>
      )}
      {barPercent !== undefined && (
        <div className="absolute bottom-0 left-0 h-[3px] w-full bg-gray-100">
          <div
            className={`h-full ${c.bar} transition-all`}
            style={{ width: `${Math.min(100, Math.max(0, barPercent))}%` }}
          />
        </div>
      )}
    </div>
  );
}
