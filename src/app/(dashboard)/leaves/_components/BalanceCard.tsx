"use client";

import { X } from "lucide-react";
import type { LeaveBalance } from "./types";

export function BalanceMini({
  label,
  value,
  sub,
  adjust,
  negative,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  adjust?: number;
  negative?: boolean;
  color: "blue" | "amber" | "red" | "teal";
}) {
  const colorMap: Record<string, string> = {
    blue: "text-on-primary-container",
    amber: "text-warning",
    red: "text-error",
    teal: "text-success",
  };
  return (
    <div className="rounded-md bg-surface-container-lowest px-3 py-2 shadow-card ring-1 ring-outline-variant/30">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </p>
      <p className={`mt-0.5 text-lg font-extrabold tabular-nums ${negative ? "text-red-600" : colorMap[color]}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-outline-variant">{sub}</p>
      {adjust !== undefined && adjust !== 0 && (
        <p className="mt-0.5 text-[10px] font-semibold text-violet-700">
          Rettifica: {adjust > 0 ? "+" : ""}{adjust}
        </p>
      )}
    </div>
  );
}

const BALANCE_ITEM_COLORS: Record<string, { bg: string; text: string }> = {
  blue:  { bg: "bg-primary-container",   text: "text-on-primary-container" },
  amber: { bg: "bg-warning-container",   text: "text-warning" },
  red:   { bg: "bg-error-container",     text: "text-error" },
  teal:  { bg: "bg-success-container",   text: "text-success" },
};

function BalanceItem({ label, value, sub, color, numericValue }: { label: string; value: string; sub: string; color: string; numericValue?: number }) {
  const isNegative = numericValue !== undefined && numericValue < 0;
  const { bg, text } = isNegative
    ? { bg: "bg-error-container ring-1 ring-error/30", text: "text-error" }
    : (BALANCE_ITEM_COLORS[color] ?? { bg: "bg-surface-container-low", text: "text-on-surface" });
  return (
    <div className={`rounded-lg ${bg} p-3`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className={`mt-1 text-xl font-extrabold ${text}`}>{value}</p>
      <p className="mt-1 text-xs text-outline-variant">{sub}</p>
    </div>
  );
}

export function BalanceCard({ balance, employeeName, onClose }: { balance: LeaveBalance; employeeName: string; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold uppercase tracking-wider text-primary">
          Saldo {balance.year} — {employeeName}
        </h3>
        <button onClick={onClose} className="text-outline-variant hover:text-on-surface">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <BalanceItem label="Ferie residue" value={`${balance.vacationRemaining} gg`} sub={`Maturate: ${balance.vacationAccrued} | Usate: ${balance.vacationUsed}`} color="blue" numericValue={balance.vacationRemaining} />
        <BalanceItem label="ROL residui" value={`${balance.rolRemaining} h`} sub={`Maturate: ${balance.rolAccrued} | Usate: ${balance.rolUsed}`} color="amber" numericValue={balance.rolRemaining} />
        <BalanceItem label="Malattia" value={`${balance.sickDays} gg`} sub="Nessun limite annuale" color="red" />
        <BalanceItem label="Contratto" value={balance.contractType === "FULL_TIME" ? "Full-time" : "Part-time"} sub={`${balance.weeklyHours}h/settimana`} color="teal" />
      </div>
    </div>
  );
}
