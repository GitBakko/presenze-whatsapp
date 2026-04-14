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
    blue: "text-blue-700",
    amber: "text-amber-700",
    red: "text-red-700",
    teal: "text-teal-700",
  };
  return (
    <div className="rounded-md bg-white px-3 py-2 shadow-sm ring-1 ring-surface-container">
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

function BalanceItem({ label, value, sub, color, numericValue }: { label: string; value: string; sub: string; color: string; numericValue?: number }) {
  const isNegative = numericValue !== undefined && numericValue < 0;
  const bgClass = isNegative ? "bg-red-50 ring-1 ring-red-200" : `bg-${color}-50`;
  const textClass = isNegative ? "text-red-600" : `text-${color}-700`;
  return (
    <div className={`rounded-lg ${bgClass} p-3`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className={`mt-1 text-xl font-extrabold ${textClass}`}>{value}</p>
      <p className="mt-1 text-xs text-outline-variant">{sub}</p>
    </div>
  );
}

export function BalanceCard({ balance, employeeName, onClose }: { balance: LeaveBalance; employeeName: string; onClose: () => void }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-white p-5 shadow-sm">
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
