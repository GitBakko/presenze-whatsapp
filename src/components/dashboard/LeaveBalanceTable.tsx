"use client";

import Link from "next/link";
import type { LeaveBalanceRow } from "@/types/dashboard";
import { StatusBadge } from "@/components/StatusBadge";

function barColor(percent: number): string {
  if (percent > 85) return "bg-error";
  if (percent >= 60) return "bg-warning";
  return "bg-primary";
}

export function LeaveBalanceTable({
  rows,
}: {
  rows: LeaveBalanceRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 text-center text-sm text-on-surface-variant">
        Nessun dato disponibile sui saldi ferie
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5">
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
              <th scope="col" className="pb-2 pr-4 font-medium">Dipendente</th>
              <th scope="col" className="pb-2 pr-4 font-medium">Ferie</th>
              <th scope="col" className="hidden pb-2 pr-4 font-medium sm:table-cell" style={{ minWidth: 120 }}>
                Progresso
              </th>
              <th scope="col" className="pb-2 pr-4 font-medium text-right">ROL residue</th>
              <th scope="col" className="pb-2 font-medium" />
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
                    <StatusBadge
                      kind="error"
                      className="text-[10px]"
                    >
                      Scadenza
                    </StatusBadge>
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
