"use client";

import { useMemo, useState } from "react";
import { CalendarX2, CheckCircle, XCircle, Trash2, Pencil, Search, X } from "lucide-react";
import type { LeaveRequest } from "./types";
import { TYPE_COLORS, STATUS_COLORS, STATUS_LABELS, LEAVE_TYPE_OPTIONS } from "./types";

export function RequestsList({
  requests,
  statusFilter,
  onStatusFilter,
  onApprove,
  onReject,
  onDelete,
  onEdit,
  onSelectEmployee,
  isAdmin = true,
}: {
  requests: LeaveRequest[];
  statusFilter: string;
  onStatusFilter: (s: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (r: LeaveRequest) => void;
  onEdit: (r: LeaveRequest) => void;
  onSelectEmployee: (id: string) => void;
  isAdmin?: boolean;
}) {
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    return requests.filter((r) => {
      if (typeFilter !== "ALL" && r.type !== typeFilter) return false;
      if (q && !r.employeeName.toLowerCase().includes(q)) return false;
      // Period overlap with [dateFrom, dateTo] if either bound set.
      if (dateFrom && r.endDate < dateFrom) return false;
      if (dateTo && r.startDate > dateTo) return false;
      return true;
    });
  }, [requests, typeFilter, employeeQuery, dateFrom, dateTo]);

  const hasExtraFilters = typeFilter !== "ALL" || employeeQuery !== "" || dateFrom !== "" || dateTo !== "";
  function resetFilters() {
    setTypeFilter("ALL");
    setEmployeeQuery("");
    setDateFrom("");
    setDateTo("");
  }

  return (
    <div className="space-y-4">
      {/* Status pills */}
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

      {/* Advanced filters */}
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
          Tipo
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-outline-variant/50 bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none"
          >
            <option value="ALL">Tutti i tipi</option>
            {LEAVE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant sm:col-span-1 lg:col-span-2">
          Dipendente
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-outline-variant" />
            <input
              type="text"
              value={employeeQuery}
              onChange={(e) => setEmployeeQuery(e.target.value)}
              placeholder="Cerca per nome…"
              className="w-full rounded-md border border-outline-variant/50 bg-surface-container-lowest pl-7 pr-2 py-1.5 text-sm text-on-surface placeholder:text-outline-variant focus:border-primary focus:outline-none"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
          Da
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-md border border-outline-variant/50 bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-on-surface-variant">
          A
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-md border border-outline-variant/50 bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none"
          />
        </label>

        {hasExtraFilters && (
          <button
            onClick={resetFilters}
            className="self-end inline-flex items-center justify-center gap-1 rounded-md bg-surface-container px-2 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high sm:col-span-2 lg:col-span-5 lg:justify-self-end lg:px-3"
          >
            <X className="h-3.5 w-3.5" />
            Azzera filtri ({filtered.length} di {requests.length})
          </button>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
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
              {filtered.map((r) => (
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
                      {(r.status === "APPROVED" || r.status === "PENDING") && (
                        <button onClick={() => onEdit(r)} aria-label="Modifica" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-outline-variant hover:bg-surface-container-high hover:text-primary" title="Modifica">
                          <Pencil className="h-5 w-5" />
                        </button>
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
