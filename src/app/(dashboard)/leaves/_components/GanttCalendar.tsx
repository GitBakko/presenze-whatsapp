"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getShortName } from "@/lib/avatar-utils";
import { todayRome } from "@/lib/tz";
import type { CalendarDay } from "./types";
import { TYPE_COLORS, PREDICTOR_STYLES } from "./types";

/** Working hours: 09:00 – 18:30 in 30-min slots = 19 slots */
const DAY_START = 9 * 60; // 540 min
const DAY_END = 18 * 60 + 30; // 1110 min
const DAY_SPAN = DAY_END - DAY_START; // 570 min
const SLOT_MINUTES = 30;
const SLOT_COUNT = DAY_SPAN / SLOT_MINUTES; // 19

const TIME_LABELS: string[] = [];
for (let m = DAY_START; m <= DAY_END; m += SLOT_MINUTES) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  TIME_LABELS.push(`${h}:${String(mm).padStart(2, "0")}`);
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

interface BlockInfo {
  employeeName: string;
  typeLabel: string;
  type: string;
  startMin: number;
  endMin: number;
  status: string;
  source: string;
  confirmedAt: string | null;
}

function mkBlock(ev: CalendarDay["events"][number], startMin: number, endMin: number): BlockInfo {
  return {
    employeeName: ev.employeeName,
    typeLabel: ev.typeLabel,
    type: ev.type,
    startMin,
    endMin,
    status: ev.status,
    source: ev.source,
    confirmedAt: ev.confirmedAt,
  };
}

function resolveBlocks(day: CalendarDay): BlockInfo[] {
  const blocks: BlockInfo[] = [];

  for (const ev of day.events) {
    if (ev.status === "REJECTED") continue;

    // Determine start/end in minutes
    if (ev.timeSlots && ev.timeSlots.length > 0) {
      // ROL / permesso with explicit time slots
      for (const slot of ev.timeSlots) {
        blocks.push(mkBlock(ev, hmToMin(slot.from), hmToMin(slot.to)));
      }
    } else if (ev.type === "VACATION_HALF_AM") {
      blocks.push(mkBlock(ev, DAY_START, 13 * 60)); // 13:00
    } else if (ev.type === "VACATION_HALF_PM") {
      blocks.push(mkBlock(ev, 14 * 60 + 30, DAY_END)); // 14:30
    } else {
      // Full day (VACATION, SICK, etc.)
      blocks.push(mkBlock(ev, DAY_START, DAY_END));
    }
  }

  return blocks;
}

export function GanttCalendar({
  calendarDays,
  monthLabel,
  onChangeMonth,
  onClose,
}: {
  calendarDays: CalendarDay[];
  monthLabel: string;
  onChangeMonth: (delta: number) => void;
  onClose: () => void;
}) {
  // All employee names for disambiguation
  const allNames = useMemo(() => {
    const names = new Set<string>();
    for (const day of calendarDays) {
      for (const ev of day.events) names.add(ev.employeeName);
    }
    return Array.from(names);
  }, [calendarDays]);

  // Only show working days (Mon-Fri) with events, or all weekdays
  const workingDays = useMemo(() => {
    return calendarDays.filter((d) => {
      const dow = new Date(d.date).getDay();
      return dow >= 1 && dow <= 5; // Mon-Fri
    });
  }, [calendarDays]);

  const SLOT_HEIGHT = 28; // px per 30-min slot
  const TIMELINE_HEIGHT = SLOT_COUNT * SLOT_HEIGHT;

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-container px-5 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => onChangeMonth(-1)} aria-label="Mese precedente" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h3 className="font-display text-sm font-bold uppercase tracking-wider text-primary capitalize">
            {monthLabel}
          </h3>
          <button onClick={() => onChangeMonth(1)} aria-label="Mese successivo" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg bg-surface-container px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high"
        >
          Vista standard
        </button>
      </div>

      {/* Gantt grid */}
      <div className="overflow-x-auto">
        <div className="inline-flex min-w-full">
          {/* Time axis (left column) */}
          <div className="sticky left-0 z-10 w-14 flex-shrink-0 border-r border-surface-container bg-surface-container-lowest">
            {/* Empty header cell */}
            <div className="h-8 border-b border-surface-container" />
            {/* Time labels */}
            <div className="relative" style={{ height: TIMELINE_HEIGHT }}>
              {TIME_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-b border-surface-container-low text-[10px] text-on-surface-variant"
                  style={{ top: i * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                >
                  <span className="absolute -top-[7px] left-1">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          {workingDays.map((day) => {
            const dayNum = parseInt(day.date.split("-")[2]);
            const dowLabel = new Date(day.date).toLocaleDateString("it-IT", { weekday: "short" });
            const isToday = day.date === todayRome();
            const blocks = resolveBlocks(day);

            return (
              <div
                key={day.date}
                className={`flex-1 border-r border-surface-container-low ${isToday ? "bg-primary/5" : ""}`}
                style={{ minWidth: 80 }}
              >
                {/* Day header */}
                <div className={`flex h-8 items-center justify-center border-b border-surface-container text-xs font-semibold ${isToday ? "text-primary" : "text-on-surface-variant"}`}>
                  <span className="capitalize">{dowLabel}</span>
                  <span className={`ml-1 ${isToday ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white text-[10px]" : ""}`}>
                    {dayNum}
                  </span>
                </div>

                {/* Timeline area */}
                <div className="relative" style={{ height: TIMELINE_HEIGHT }}>
                  {/* Grid lines (30-min slots) */}
                  {TIME_LABELS.map((_, i) => (
                    <div
                      key={i}
                      className={`absolute left-0 right-0 border-b ${i % 2 === 1 ? "border-surface-container" : "border-surface-container-low"}`}
                      style={{ top: i * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                    />
                  ))}

                  {/* Event blocks */}
                  {blocks.map((block, bi) => {
                    const clampedStart = Math.max(block.startMin, DAY_START);
                    const clampedEnd = Math.min(block.endMin, DAY_END);
                    const topPx = ((clampedStart - DAY_START) / DAY_SPAN) * TIMELINE_HEIGHT;
                    const heightPx = Math.max(14, ((clampedEnd - clampedStart) / DAY_SPAN) * TIMELINE_HEIGHT);
                    const isPending = block.status === "PENDING";
                    const isPredictor = block.source === "PREDICTOR";
                    // Predictor blocks replace the type color with the violet
                    // ghost style: dashed = proposta, solid = confermata.
                    const blockColor = isPredictor
                      ? block.confirmedAt ? PREDICTOR_STYLES.confirmed : PREDICTOR_STYLES.unconfirmed
                      : TYPE_COLORS[block.type] ?? "bg-surface-container-high text-on-surface";

                    // Stack blocks side by side: compute column among overlapping blocks
                    const overlapping = blocks.filter((b, j) =>
                      j !== bi && b.startMin < block.endMin && b.endMin > block.startMin
                    );
                    const colCount = overlapping.length + 1;
                    // Simple index: count how many overlapping blocks come before this one
                    const colIndex = blocks.filter((b, j) =>
                      j < bi && b.startMin < block.endMin && b.endMin > block.startMin
                    ).length;

                    const leftPct = (colIndex / colCount) * 100;
                    const widthPct = (1 / colCount) * 100;

                    return (
                      <div
                        key={bi}
                        aria-label={`${block.employeeName} — ${block.typeLabel}${isPredictor ? (block.confirmedAt ? " (predittore, confermato)" : " (predittore, da confermare)") : ""}`}
                        className={`absolute overflow-hidden rounded px-1 py-0.5 text-[9px] font-semibold leading-tight ${blockColor} ${isPending ? "opacity-60 ring-1 ring-inset ring-yellow-400" : ""}`}
                        style={{
                          top: topPx,
                          height: heightPx,
                          left: `${leftPct + 1}%`,
                          width: `${widthPct - 2}%`,
                        }}
                        title={`${block.employeeName} — ${block.typeLabel}`}
                      >
                        <span className="block truncate">
                          {getShortName(block.employeeName, allNames)}
                        </span>
                        {heightPx > 30 && (
                          <span className="block truncate opacity-75">
                            {block.typeLabel}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 border-t border-surface-container px-5 py-3">
        {[
          { label: "Ferie", color: "bg-blue-100 text-blue-800" },
          { label: "ROL", color: "bg-amber-100 text-amber-800" },
          { label: "Malattia", color: "bg-red-100 text-red-800" },
          { label: "Altro", color: "bg-purple-100 text-purple-800" },
          { label: "Predittore (proposta)", color: PREDICTOR_STYLES.unconfirmed },
          { label: "Predittore confermato", color: PREDICTOR_STYLES.confirmed },
        ].map((item) => (
          <span key={item.label} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${item.color}`}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
