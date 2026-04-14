"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Hourglass, X } from "lucide-react";
import type { CalendarDay, CalendarEvent } from "./types";
import { TYPE_COLORS, STATUS_COLORS, STATUS_LABELS } from "./types";

export function CalendarView({
  calendarDays,
  calendarMonth: _calendarMonth,
  monthLabel,
  firstDay,
  onChangeMonth,
}: {
  calendarDays: CalendarDay[];
  calendarMonth: string;
  monthLabel: string;
  firstDay: number;
  onChangeMonth: (delta: number) => void;
  onSelectEmployee: (id: string) => void;
}) {
  const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const today = new Date().toISOString().split("T")[0];
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const SOURCE_LABELS: Record<string, string> = {
    MANAGER: "Manager",
    EXTERNAL_API: "API / Bot / Email",
  };

  const formatDate = (d: string) => {
    const [, m, day] = d.split("-");
    return `${parseInt(day)}/${parseInt(m)}`;
  };

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-white shadow-sm">
      {/* Month nav */}
      <div className="flex items-center justify-between border-b border-surface-container px-5 py-4">
        <button onClick={() => onChangeMonth(-1)} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container-high">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h3 className="font-display text-sm font-bold uppercase tracking-wider text-primary capitalize">
          {monthLabel}
        </h3>
        <button onClick={() => onChangeMonth(1)} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container-high">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-surface-container">
        {dayNames.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wider text-outline-variant">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className="min-h-[80px] border-b border-r border-surface-container-low bg-surface-container-low" />
        ))}

        {calendarDays.map((day) => {
          const isToday = day.date === today;
          const dayNum = parseInt(day.date.split("-")[2]);
          const isWeekend = (() => {
            const d = new Date(day.date);
            return d.getDay() === 0 || d.getDay() === 6;
          })();

          return (
            <div
              key={day.date}
              className={`min-h-[80px] border-b border-r border-surface-container-low p-1.5 ${isWeekend ? "bg-surface-container-low/50" : ""} ${isToday ? "bg-primary/5" : ""}`}
            >
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${isToday ? "bg-primary text-white" : "text-on-surface-variant"}`}>
                {dayNum}
              </span>
              <div className="mt-0.5 space-y-0.5">
                {day.events.slice(0, 3).map((ev, i) => {
                  const isPending = ev.status === "PENDING";
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedEvent(ev)}
                      className={`block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold leading-tight ${TYPE_COLORS[ev.type] ?? "bg-surface-container-high text-on-surface"} ${isPending ? "opacity-60 ring-1 ring-inset ring-yellow-400 ring-offset-0" : ""}`}
                      title={`${ev.employeeName} — ${ev.typeLabel}${isPending ? " (in attesa)" : ""}`}
                    >
                      {isPending && <Hourglass className="mr-0.5 inline h-2.5 w-2.5" />}{ev.employeeName.split(" ")[0]}
                    </button>
                  );
                })}
                {day.events.length > 3 && (
                  <span className="block text-center text-[10px] text-outline-variant">
                    +{day.events.length - 3}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 border-t border-surface-container px-5 py-3">
        {[
          { label: "Ferie", color: "bg-blue-100 text-blue-800" },
          { label: "ROL", color: "bg-amber-100 text-amber-800" },
          { label: "Malattia", color: "bg-red-100 text-red-800" },
          { label: "Altro", color: "bg-purple-100 text-purple-800" },
        ].map((item) => (
          <span key={item.label} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${item.color}`}>
            {item.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-400">
          <Hourglass className="h-2.5 w-2.5" /> In attesa
        </span>
      </div>

      {/* Popup dettaglio richiesta */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-on-surface">
                  {selectedEvent.employeeName}
                </h3>
                <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${TYPE_COLORS[selectedEvent.type] ?? "bg-surface-container-high text-on-surface"}`}>
                  {selectedEvent.typeLabel}
                </span>
                <span className={`ml-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_COLORS[selectedEvent.status] ?? ""}`}>
                  {STATUS_LABELS[selectedEvent.status] ?? selectedEvent.status}
                </span>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="rounded p-1 text-on-surface-variant hover:bg-surface-container"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                <span className="text-xs font-medium text-on-surface-variant">Periodo</span>
                <span className="font-semibold text-on-surface">
                  {selectedEvent.startDate === selectedEvent.endDate
                    ? formatDate(selectedEvent.startDate)
                    : `${formatDate(selectedEvent.startDate)} → ${formatDate(selectedEvent.endDate)}`}
                </span>
              </div>

              {selectedEvent.hours && (
                <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="text-xs font-medium text-on-surface-variant">Ore</span>
                  <span className="font-semibold text-on-surface">{selectedEvent.hours}h</span>
                </div>
              )}

              {selectedEvent.timeSlots && selectedEvent.timeSlots.length > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="text-xs font-medium text-on-surface-variant">Fascia oraria</span>
                  <span className="font-semibold text-on-surface">
                    {selectedEvent.timeSlots.map((s) => `${s.from} – ${s.to}`).join(", ")}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                <span className="text-xs font-medium text-on-surface-variant">Origine</span>
                <span className="text-xs text-on-surface">
                  {SOURCE_LABELS[selectedEvent.source] ?? selectedEvent.source}
                </span>
              </div>

              {selectedEvent.approvedBy && (
                <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="text-xs font-medium text-on-surface-variant">Approvato da</span>
                  <span className="text-xs text-on-surface">{selectedEvent.approvedBy}</span>
                </div>
              )}

              {selectedEvent.approvedAt && (
                <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="text-xs font-medium text-on-surface-variant">Data approvazione</span>
                  <span className="text-xs text-on-surface">
                    {new Date(selectedEvent.approvedAt).toLocaleDateString("it-IT", {
                      day: "2-digit", month: "2-digit", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2">
                <span className="text-xs font-medium text-on-surface-variant">Creata il</span>
                <span className="text-xs text-on-surface">
                  {new Date(selectedEvent.createdAt).toLocaleDateString("it-IT", {
                    day: "2-digit", month: "2-digit", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>

              {selectedEvent.notes && (
                <div className="rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="text-xs font-medium text-on-surface-variant">Note</span>
                  <p className="mt-1 text-xs text-on-surface">{selectedEvent.notes}</p>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setSelectedEvent(null)}
                className="rounded-md bg-surface-container px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-high"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
