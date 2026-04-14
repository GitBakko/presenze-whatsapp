"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { X } from "lucide-react";
import { hmToMinutes } from "@/lib/date-utils";
import type { Employee } from "./types";
import { LEAVE_TYPE_OPTIONS } from "./types";

export function CreateLeaveModal({
  employees,
  onClose,
  onCreated,
  loading,
  setLoading,
}: {
  employees: Employee[];
  onClose: () => void;
  onCreated: () => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
}) {
  const { data: modalSession } = useSession();
  const modalRole = (modalSession?.user as { role?: string } | undefined)?.role ?? "EMPLOYEE";
  const modalEmployeeId = (modalSession?.user as { employeeId?: string | null } | undefined)?.employeeId ?? null;
  const isModalAdmin = modalRole === "ADMIN";

  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("VACATION");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hours, setHours] = useState("");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [sickProtocol, setSickProtocol] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const needsHours = ["ROL", "BEREAVEMENT", "MARRIAGE", "LAW_104", "MEDICAL_VISIT"].includes(type);
  const isSick = type === "SICK";
  const isHalfDay = type === "VACATION_HALF_AM" || type === "VACATION_HALF_PM";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const resolvedEmpId = isModalAdmin ? employeeId : (modalEmployeeId ?? "");
    if (!resolvedEmpId || !startDate) {
      setError(isModalAdmin ? "Seleziona dipendente e data" : "Seleziona la data");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: resolvedEmpId,
          type,
          startDate,
          endDate: isHalfDay ? startDate : (endDate || startDate),
          hours: needsHours ? (
            timeFrom && timeTo
              ? Math.round(((hmToMinutes(timeTo) - hmToMinutes(timeFrom)) / 60) * 10) / 10
              : parseFloat(hours) || null
          ) : null,
          timeSlots: needsHours && timeFrom && timeTo
            ? [{ from: timeFrom, to: timeTo }]
            : null,
          sickProtocol: isSick ? sickProtocol || null : null,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        try {
          const data = await res.json();
          setError(data.error || "Errore nella creazione");
        } catch {
          setError("Errore nella creazione");
        }
        return;
      }

      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-primary">Nuova Richiesta</h2>
          <button onClick={onClose} className="text-outline-variant hover:text-on-surface">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Employee (solo per admin) */}
          {isModalAdmin ? (
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Dipendente</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <option value="">Seleziona...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </select>
          </div>
          ) : null}

          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {LEAVE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                {isHalfDay ? "Data" : "Data inizio"}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </div>
            {!isHalfDay && (
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Data fine</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                />
              </div>
            )}
          </div>

          {/* Hours (for ROL-type) */}
          {needsHours && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Dalle</label>
                  <input
                    type="time"
                    value={timeFrom}
                    onChange={(e) => {
                      setTimeFrom(e.target.value);
                      if (e.target.value && timeTo) {
                        const mins = hmToMinutes(timeTo) - hmToMinutes(e.target.value);
                        if (mins > 0) setHours(String(Math.round((mins / 60) * 10) / 10));
                      }
                    }}
                    className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    placeholder="09:00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Alle</label>
                  <input
                    type="time"
                    value={timeTo}
                    onChange={(e) => {
                      setTimeTo(e.target.value);
                      if (timeFrom && e.target.value) {
                        const mins = hmToMinutes(e.target.value) - hmToMinutes(timeFrom);
                        if (mins > 0) setHours(String(Math.round((mins / 60) * 10) / 10));
                      }
                    }}
                    className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    placeholder="10:00"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                  Ore totali {timeFrom && timeTo ? "(calcolate)" : ""}
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  readOnly={!!(timeFrom && timeTo)}
                  className={`w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${timeFrom && timeTo ? "bg-gray-50 text-gray-500" : ""}`}
                  placeholder="Es: 2"
                />
                <p className="mt-1 text-[11px] text-outline-variant">
                  Specifica &quot;Dalle — Alle&quot; per inserire la fascia oraria esatta, oppure lascia vuoti e inserisci solo le ore totali.
                </p>
              </div>
            </div>
          )}

          {/* Sick protocol */}
          {isSick && (
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Protocollo INPS (opzionale)</label>
              <input
                type="text"
                value={sickProtocol}
                onChange={(e) => setSickProtocol(e.target.value)}
                className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                placeholder="Numero certificato"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-on-surface-variant">Note (opzionale)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 text-sm focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>

          {error && (
            <p className="text-sm font-semibold text-red-500">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-bold text-white shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Salvataggio..." : "Crea richiesta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
