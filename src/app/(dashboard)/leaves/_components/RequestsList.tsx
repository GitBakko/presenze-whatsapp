"use client";

import { CalendarX2, CheckCircle, XCircle, Trash2 } from "lucide-react";
import type { LeaveRequest } from "./types";
import { TYPE_COLORS, STATUS_COLORS, STATUS_LABELS } from "./types";

export function RequestsList({
  requests,
  statusFilter,
  onStatusFilter,
  onApprove,
  onReject,
  onDelete,
  onSelectEmployee,
  isAdmin = true,
}: {
  requests: LeaveRequest[];
  statusFilter: string;
  onStatusFilter: (s: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (r: LeaveRequest) => void;
  onSelectEmployee: (id: string) => void;
  isAdmin?: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2">
        {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
          <button
            key={s}
            onClick={() => onStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-bold transition-all ${statusFilter === s ? "bg-primary text-white" : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"}`}
          >
            {s === "ALL" ? "Tutte" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Table */}
      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-outline-variant/30 bg-surface-container-lowest py-16 text-center">
          <CalendarX2 className="mb-3 h-12 w-12 text-outline-variant" />
          <p className="text-sm text-on-surface-variant">Nessuna richiesta trovata</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-container bg-surface-container-low/50">
                <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Dipendente</th>
                <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Tipo</th>
                <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Periodo</th>
                <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Ore</th>
                <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Stato</th>
                <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Fonte</th>
                <th scope="col" className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-outline-variant">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {requests.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-surface-container-low/50">
                  <td className="px-4 py-3">
                    <button onClick={() => onSelectEmployee(r.employeeId)} className="font-semibold text-primary hover:underline">
                      {r.employeeName}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${TYPE_COLORS[r.type] ?? "bg-surface-container-high text-on-surface"}`}>
                      {r.typeLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    {r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`}
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    {r.hours ? `${r.hours}h` : "\u2014"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_COLORS[r.status] ?? ""}`}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-outline-variant">
                    {r.source === "EXTERNAL_API" ? "API" : "Manager"}
                  </td>
                  {isAdmin && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {r.status === "PENDING" && (
                        <>
                          <button onClick={() => onApprove(r.id)} aria-label="Approva" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-success hover:bg-success-container" title="Approva">
                            <CheckCircle className="h-5 w-5" />
                          </button>
                          <button onClick={() => onReject(r.id)} aria-label="Rifiuta" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-error hover:bg-error-container" title="Rifiuta">
                            <XCircle className="h-5 w-5" />
                          </button>
                        </>
                      )}
                      <button onClick={() => onDelete(r)} aria-label="Elimina" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-outline-variant hover:bg-surface-container-high hover:text-error" title="Elimina">
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
