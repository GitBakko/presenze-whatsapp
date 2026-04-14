"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { LeaveBalanceRow } from "@/types/dashboard";

function barColor(percent: number): string {
  if (percent > 85) return "bg-red-500";
  if (percent >= 60) return "bg-amber-500";
  return "bg-blue-500";
}

export function LeaveBalanceTable({
  rows,
}: {
  rows: LeaveBalanceRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant/30 bg-white p-5 text-center text-sm text-on-surface-variant">
        Nessun dato disponibile sui saldi ferie
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-on-surface">
          Saldi ferie & ROL
        </h3>
        <Link
          href="/leaves"
          className="text-xs font-medium text-primary hover:underline"
        >
          Dettaglio bilancio →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-surface-container text-xs text-on-surface-variant">
              <th className="pb-2 pr-4 font-medium">Dipendente</th>
              <th className="pb-2 pr-4 font-medium">Ferie</th>
              <th className="hidden pb-2 pr-4 font-medium sm:table-cell" style={{ minWidth: 120 }}>
                Progresso
              </th>
              <th className="pb-2 pr-4 font-medium text-right">ROL residue</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.employeeId}
                className="border-b border-surface-container-low last:border-0"
              >
                <td className="py-2.5 pr-4">
                  <span className="font-medium text-on-surface">
                    {r.employeeName}
                  </span>
                </td>
                <td className="py-2.5 pr-4 tabular-nums text-xs text-on-surface-variant">
                  {r.vacationUsed}/{r.vacationTotal} gg
                </td>
                <td className="hidden py-2.5 pr-4 sm:table-cell">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-surface-container">
                      <div
                        className={`h-full rounded-full transition-all ${barColor(r.vacationPercent)}`}
                        style={{
                          width: `${Math.min(100, Math.max(0, r.vacationPercent))}%`,
                        }}
                      />
                    </div>
                    <span className="w-9 text-right text-[11px] tabular-nums text-on-surface-variant">
                      {Math.round(r.vacationPercent)}%
                    </span>
                  </div>
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-xs text-on-surface-variant">
                  {r.rolRemaining} h
                </td>
                <td className="py-2.5">
                  {r.alert && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                      title="Meno di 5 giorni di ferie residue nella seconda metà dell'anno"
                    >
                      <AlertTriangle className="h-3 w-3" /> Scadenza
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
