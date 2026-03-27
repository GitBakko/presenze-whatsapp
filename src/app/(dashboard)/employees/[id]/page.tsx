"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { hoursToHHMM, minutesToHHMM, formatDate } from "@/lib/formatTime";
import {
  CalendarDays, Clock, Coffee, Flame, AlertTriangle,
  DoorOpen, Home, Timer, X, Hourglass, CheckCircle2,
  Pencil, Save, Trash2, Plus,
} from "lucide-react";
import type { ReactNode } from "react";

interface DailyStat {
  employeeId: string;
  employeeName: string;
  date: string;
  entries: string[];
  exits: string[];
  hoursWorked: number;
  pauseMinutes: number;
  morningDelay: number;
  afternoonDelay: number;
  overtime: number;
  hasAnomaly: boolean;
  anomalies: { type: string; description: string }[];
  pauses: { start: string; end: string; minutes: number }[];
  overtimeBlocks: { start: string; end: string; minutes: number; explicit: boolean }[];
}

interface EmployeeProfile {
  displayName: string | null;
  avatarUrl: string | null;
}

interface LeaveEvent {
  type: string;
  typeLabel: string;
  status: string;
  hours?: number | null;
}

interface DayRecord {
  id: string;
  type: string;
  declaredTime: string;
}

const TYPE_LABELS: Record<string, string> = {
  ENTRY: "Entrata",
  EXIT: "Uscita",
  PAUSE_START: "Inizio pausa",
  PAUSE_END: "Fine pausa",
  OVERTIME_START: "Inizio straordinario",
  OVERTIME_END: "Fine straordinario",
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  const d = new Date(year, month - 1, 1).getDay();
  return d === 0 ? 7 : d;
}

const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const MONTH_NAMES = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [data, setData] = useState<DailyStat[]>([]);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<DailyStat | null>(null);
  const [leaveBalance, setLeaveBalance] = useState<{
    vacationRemaining: number; vacationAccrued: number; vacationUsed: number;
    rolRemaining: number; rolAccrued: number; rolUsed: number;
    sickDays: number; weeklyHours: number; contractType: string;
  } | null>(null);
  const [leaveMap, setLeaveMap] = useState<Map<string, LeaveEvent[]>>(new Map());
  const [editingRecords, setEditingRecords] = useState<DayRecord[] | null>(null);
  const [savingRecords, setSavingRecords] = useState(false);

  const [y, m] = month.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = getDaysInMonth(y, m);
  const to = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;

  const load = useCallback(() => {
    setLoading(true);
    const monthStr = `${y}-${String(m).padStart(2, "0")}`;
    Promise.all([
      fetch(`/api/attendance?from=${from}&to=${to}&employeeId=${id}`).then((r) => r.json()),
      fetch(`/api/employees/${id}`).then((r) => r.json()),
      fetch(`/api/leaves/balance/${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/leaves/calendar?month=${monthStr}`).then((r) => r.ok ? r.json() : null),
    ])
      .then(([stats, emp, bal, cal]: [DailyStat[], EmployeeProfile & { name: string }, typeof leaveBalance, { calendar: { date: string; events: { employeeId: string; type: string; typeLabel: string; status: string; hours?: number | null }[] }[] } | null]) => {
        setData(stats);
        // Update selectedDay with fresh data if still viewing the same date
        setSelectedDay((prev) => {
          if (!prev) return null;
          return stats.find((s) => s.date === prev.date) ?? null;
        });
        setProfile(emp);
        setEmployeeName(emp.displayName || emp.name || (stats[0]?.employeeName ?? ""));
        setLeaveBalance(bal);
        // Build leave map for this employee
        const lm = new Map<string, LeaveEvent[]>();
        if (cal?.calendar) {
          for (const day of cal.calendar) {
            const evts = day.events.filter((e) => e.employeeId === id);
            if (evts.length > 0) lm.set(day.date, evts);
          }
        }
        setLeaveMap(lm);
      })
      .finally(() => setLoading(false));
  }, [from, to, id, m, y]);

  useEffect(() => { load(); }, [load]);

  // Month summary
  const totalHours = data.reduce((s, d) => s + d.hoursWorked, 0);
  const totalPause = data.reduce((s, d) => s + d.pauseMinutes, 0);
  const totalOvertime = data.reduce((s, d) => s + d.overtime, 0);
  const totalDelayDays = data.filter((d) => d.morningDelay + d.afternoonDelay > 0).length;
  const totalAnomalies = data.filter((d) => d.hasAnomaly).length;

  // Build date map
  const dateMap = new Map<string, DailyStat>();
  for (const d of data) dateMap.set(d.date, d);

  const firstWeekday = getFirstDayOfWeek(y, m);
  const totalDays = getDaysInMonth(y, m);
  const today = new Date().toISOString().split("T")[0];

  // Build calendar grid
  const calendarCells: (number | null)[] = [];
  for (let i = 1; i < firstWeekday; i++) calendarCells.push(null);
  for (let d = 1; d <= totalDays; d++) calendarCells.push(d);
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  const navigateMonth = (dir: -1 | 1) => {
    let nm = m + dir;
    let ny = y;
    if (nm < 1) { nm = 12; ny--; }
    if (nm > 12) { nm = 1; ny++; }
    setMonth(`${ny}-${String(nm).padStart(2, "0")}`);
    setSelectedDay(null);
  };

  const initials = employeeName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="space-y-6">
      {/* Header with avatar */}
      <div className="flex items-center gap-4">
        <Link href="/employees" className="text-sm text-primary hover:text-primary-container">
          ← Dipendenti
        </Link>
        <div className="flex items-center gap-3">
          {profile?.avatarUrl ? (
            <Image src={profile.avatarUrl} alt={employeeName} width={40} height={40} className="h-10 w-10 rounded-full object-cover ring-2 ring-surface-container-lowest shadow" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container text-sm font-bold text-on-primary ring-2 ring-surface-container-lowest shadow">
              {initials}
            </div>
          )}
          <h1 className="font-display text-3xl font-bold tracking-tight text-primary">{employeeName || "Dipendente"}</h1>
        </div>
      </div>

      {/* Month navigator */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigateMonth(-1)}
          className="rounded-lg border border-surface-container bg-surface-container-lowest px-3 py-2 text-sm font-medium text-on-surface-variant shadow-card hover:bg-surface-container-low"
        >
          ←
        </button>
        <div className="min-w-[160px] text-center text-lg font-semibold text-on-surface">
          {MONTH_NAMES[m - 1]} {y}
        </div>
        <button
          onClick={() => navigateMonth(1)}
          className="rounded-lg border border-surface-container bg-surface-container-lowest px-3 py-2 text-sm font-medium text-on-surface-variant shadow-card hover:bg-surface-container-low"
        >
          →
        </button>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-on-surface-variant">
          Caricamento...
        </div>
      ) : (
        <>
          {/* Month summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <SummaryCard label="Giorni lavorati" value={String(data.length)} icon={<CalendarDays className="h-4 w-4 text-blue-500" />} />
            <SummaryCard label="Ore totali" value={hoursToHHMM(totalHours)} icon={<Clock className="h-4 w-4 text-indigo-500" />} color="text-on-surface" />
            <SummaryCard label="Pausa totale" value={minutesToHHMM(totalPause)} icon={<Coffee className="h-4 w-4 text-amber-600" />} color="text-tertiary" />
            <SummaryCard label="Straordinario" value={totalOvertime > 0 ? `+${hoursToHHMM(totalOvertime)}` : "-"} icon={<Flame className="h-4 w-4 text-orange-500" />} color="text-primary" />
            <SummaryCard label="Ritardi / Anomalie" value={`${totalDelayDays} / ${totalAnomalies}`} icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} color={totalAnomalies > 0 ? "text-error" : "text-warning"} />
          </div>

          {/* Leave balance */}
          {leaveBalance && (
            <div className="rounded-lg bg-surface-container-lowest p-4 shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Saldo Ferie & Permessi</h3>
                <Link href="/leaves" className="text-xs font-semibold text-primary hover:underline">Gestisci →</Link>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className={`rounded-lg p-3 ${leaveBalance.vacationRemaining < 0 ? "bg-red-50 ring-1 ring-red-200" : "bg-blue-50"}`}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Ferie residue</p>
                  <p className={`mt-1 text-lg font-extrabold ${leaveBalance.vacationRemaining < 0 ? "text-red-600" : "text-blue-700"}`}>{leaveBalance.vacationRemaining} gg</p>
                  <p className="text-[10px] text-outline-variant">Mat. {leaveBalance.vacationAccrued} | Usate {leaveBalance.vacationUsed}</p>
                </div>
                <div className={`rounded-lg p-3 ${leaveBalance.rolRemaining < 0 ? "bg-red-50 ring-1 ring-red-200" : "bg-amber-50"}`}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">ROL residui</p>
                  <p className={`mt-1 text-lg font-extrabold ${leaveBalance.rolRemaining < 0 ? "text-red-600" : "text-amber-700"}`}>{leaveBalance.rolRemaining} h</p>
                  <p className="text-[10px] text-outline-variant">Mat. {leaveBalance.rolAccrued} | Usate {leaveBalance.rolUsed}</p>
                </div>
                <div className="rounded-lg bg-red-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Malattia</p>
                  <p className="mt-1 text-lg font-extrabold text-red-700">{leaveBalance.sickDays} gg</p>
                  <p className="text-[10px] text-outline-variant">Nessun limite</p>
                </div>
                <div className="rounded-lg bg-teal-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Contratto</p>
                  <p className="mt-1 text-lg font-extrabold text-teal-700">{leaveBalance.contractType === "FULL_TIME" ? "Full-time" : "Part-time"}</p>
                  <p className="text-[10px] text-outline-variant">{leaveBalance.weeklyHours}h/settimana</p>
                </div>
              </div>
            </div>
          )}

          {/* Calendar grid */}
          <div className="rounded-lg bg-surface-container-lowest shadow-card overflow-hidden">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-surface-container bg-surface-container-low">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-2.5 text-center text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">
                  {d}
                </div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7">
              {calendarCells.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} className="min-h-[100px] border-b border-r border-surface-container bg-surface-container-low/30" />;
                }
                const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const stat = dateMap.get(dateStr);
                const isWeekend = ((firstWeekday + day - 2) % 7) >= 5;
                const isSelected = selectedDay?.date === dateStr;
                const isToday = dateStr === today;
                const dayLeaves = leaveMap.get(dateStr) || [];

                let cellBg = isWeekend && !stat ? "bg-surface-container-low" : "bg-surface-container-lowest";
                let borderColor = "border-surface-container";
                let statusDot = "";

                if (stat) {
                  if (stat.hasAnomaly) {
                    statusDot = "bg-error";
                    borderColor = "border-error/30";
                  } else if (stat.morningDelay + stat.afternoonDelay > 0) {
                    statusDot = "bg-warning";
                    borderColor = "border-warning/30";
                  } else {
                    statusDot = "bg-success";
                  }
                }

                if (dayLeaves.length > 0 && !stat) {
                  cellBg = "bg-blue-50";
                  borderColor = "border-blue-200";
                }

                return (
                  <button
                    key={day}
                    onClick={() => { stat && setSelectedDay(stat); setEditingRecords(null); }}
                    className={`group relative flex min-h-[100px] flex-col border-b border-r p-2 text-left transition-all ${borderColor} ${cellBg} ${stat ? "cursor-pointer hover:bg-primary-fixed/20" : "cursor-default"} ${isSelected ? "ring-2 ring-inset ring-primary bg-primary-fixed/30" : ""}`}
                  >
                    {/* Day number */}
                    <div className="flex items-center gap-1.5">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-primary text-on-primary" : "text-on-surface-variant"}`}>
                        {day}
                      </span>
                      {statusDot && (
                        <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                      )}
                    </div>

                    {/* Leave events */}
                    {dayLeaves.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {dayLeaves.map((lv, i) => (
                          <div
                            key={i}
                            className={`rounded px-1 py-0.5 text-[10px] font-medium leading-tight ${
                              lv.status === "PENDING"
                                ? "bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-300"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {lv.status === "PENDING" && <Hourglass className="mr-0.5 inline h-2.5 w-2.5" />}{lv.typeLabel}
                            {lv.hours ? ` (${lv.hours}h)` : ""}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Day data */}
                    {stat && (
                      <div className="mt-auto space-y-0.5 pt-1">
                        <div className="flex items-baseline gap-1">
                          <span className="text-sm font-semibold tabular-nums text-on-surface">
                            {hoursToHHMM(stat.hoursWorked)}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                          {stat.pauseMinutes > 0 && (
                            <span className="text-[10px] font-medium tabular-nums text-tertiary inline-flex items-center gap-0.5">
                              <Coffee className="h-2.5 w-2.5" /> {minutesToHHMM(stat.pauseMinutes)}
                            </span>
                          )}
                          {stat.overtime > 0 && (
                            <span className="text-[10px] font-medium tabular-nums text-primary">
                              +{hoursToHHMM(stat.overtime)}
                            </span>
                          )}
                          {(stat.morningDelay > 0 || stat.afternoonDelay > 0) && (
                            <span className="text-[10px] font-medium tabular-nums text-warning inline-flex items-center gap-0.5">
                              <Timer className="h-2.5 w-2.5" /> {minutesToHHMM(stat.morningDelay + stat.afternoonDelay)}
                            </span>
                          )}
                        </div>
                        {stat.entries.length > 0 && (
                          <div className="text-[10px] tabular-nums text-outline-variant space-y-0.5">
                            <div>M: {stat.entries[0] ?? "?"} – {stat.exits[0] ?? "?"}</div>
                            {(stat.entries[1] || stat.exits[1]) && (
                              <div>P: {stat.entries[1] ?? "?"} – {stat.exits[1] ?? "?"}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> Regolare</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" /> Ritardo</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-error" /> Anomalia</span>
            <span className="flex items-center gap-1.5"><span className="inline-block rounded px-1 py-0.5 text-[9px] font-medium bg-blue-100 text-blue-800">Ferie</span> Approvata</span>
            <span className="flex items-center gap-1.5"><span className="inline-block rounded px-1 py-0.5 text-[9px] font-medium bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-300"><Hourglass className="inline h-2.5 w-2.5" /></span> In attesa</span>
            <span className="flex items-center gap-1.5"><span className="h-4 w-4 rounded-full bg-primary text-[9px] text-on-primary flex items-center justify-center font-bold">25</span> Oggi</span>
          </div>

          {/* Day detail panel */}
          {selectedDay && (
            <div className="rounded-lg bg-surface-container-lowest shadow-card overflow-hidden">
              <div className="border-b border-surface-container bg-surface-container-low px-6 py-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-on-surface">
                    {formatDate(selectedDay.date)}
                  </h3>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="text-outline-variant hover:text-on-surface-variant text-lg"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <DetailCard
                    icon={<DoorOpen className="h-3.5 w-3.5 text-emerald-500" />}
                    label="Mattina"
                    value={
                      selectedDay.entries[0] || selectedDay.exits[0]
                        ? `${selectedDay.entries[0] ?? "?"} – ${selectedDay.exits[0] ?? "?"}`
                        : "-"
                    }
                  />
                  <DetailCard
                    icon={<Home className="h-3.5 w-3.5 text-blue-500" />}
                    label="Pomeriggio"
                    value={
                      selectedDay.entries[1] || selectedDay.exits[1]
                        ? `${selectedDay.entries[1] ?? "?"} – ${selectedDay.exits[1] ?? "?"}`
                        : "-"
                    }
                  />
                  <DetailCard
                    icon={<Clock className="h-3.5 w-3.5 text-indigo-500" />}
                    label="Ore lavorate"
                    value={hoursToHHMM(selectedDay.hoursWorked)}
                    highlight
                  />
                  <DetailCard
                    icon={<Coffee className="h-3.5 w-3.5 text-amber-600" />}
                    label="Pausa"
                    value={selectedDay.pauseMinutes > 0 ? minutesToHHMM(selectedDay.pauseMinutes) : "-"}
                    color="purple"
                  />
                  <DetailCard
                    icon={<Timer className="h-3.5 w-3.5 text-orange-500" />}
                    label="Ritardo mattina"
                    value={selectedDay.morningDelay > 0 ? minutesToHHMM(selectedDay.morningDelay) : "-"}
                    color="yellow"
                  />
                  <DetailCard
                    icon={<Timer className="h-3.5 w-3.5 text-orange-500" />}
                    label="Ritardo pomeriggio"
                    value={selectedDay.afternoonDelay > 0 ? minutesToHHMM(selectedDay.afternoonDelay) : "-"}
                    color="yellow"
                  />
                  <DetailCard
                    icon={<Flame className="h-3.5 w-3.5 text-red-500" />}
                    label="Straordinario"
                    value={selectedDay.overtime > 0 ? `+${hoursToHHMM(selectedDay.overtime)}` : "-"}
                    color="blue"
                  />
                </div>

                {/* Pause detail */}
                {selectedDay.pauses.length > 0 && (
                  <div className="mt-5 rounded-lg border-l-4 border-tertiary bg-tertiary-fixed/20 p-4">
                    <h4 className="mb-2 text-sm font-semibold text-tertiary flex items-center gap-1.5"><Coffee className="h-4 w-4" /> Pause dettagliate</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedDay.pauses.map((p, i) => (
                        <span key={i} className="rounded-full bg-surface-container-lowest px-3 py-1 text-xs font-medium text-tertiary shadow-card ring-1 ring-tertiary/20">
                          {p.start} → {p.end} ({minutesToHHMM(p.minutes)})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Overtime detail */}
                {selectedDay.overtimeBlocks.length > 0 && (
                  <div className="mt-3 rounded-lg border-l-4 border-primary bg-primary-fixed/20 p-4">
                    <h4 className="mb-2 text-sm font-semibold text-primary flex items-center gap-1.5"><Flame className="h-4 w-4" /> Straordinario</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedDay.overtimeBlocks.map((o, i) => (
                        <span key={i} className={`rounded-full px-3 py-1 text-xs font-medium shadow-card ring-1 ${o.explicit ? "bg-surface-container-lowest text-primary ring-primary/20" : "bg-primary-fixed/20 text-primary ring-primary/20"}`}>
                          {o.start} → {o.end} ({minutesToHHMM(o.minutes)}) — {o.explicit ? "dichiarato" : "automatico"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anomalies */}
                {selectedDay.anomalies.length > 0 && (
                  <div className="mt-3 rounded-lg border-l-4 border-error bg-error-container/30 p-4">
                    <h4 className="mb-2 text-sm font-semibold text-on-error-container flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Anomalie</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedDay.anomalies.map((a, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-lowest px-3 py-1 text-xs font-medium text-error shadow-card ring-1 ring-error/20">
                          {a.description}
                          <button
                            title="Segna come corretto"
                            className="ml-1 rounded-full p-0.5 text-on-surface-variant hover:bg-success/20 hover:text-success transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              fetch("/api/anomalies/dismiss", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  employeeId: selectedDay.employeeId,
                                  date: selectedDay.date,
                                  type: a.type,
                                  description: a.description,
                                }),
                              }).then(() => load());
                            }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Edit records */}
                <div className="mt-5 border-t border-surface-container pt-5">
                  {editingRecords === null ? (
                    <button
                      className="flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-low transition-colors"
                      onClick={() => {
                        fetch(`/api/records?employeeId=${selectedDay.employeeId}&date=${selectedDay.date}`)
                          .then((r) => r.json())
                          .then((recs: DayRecord[]) => setEditingRecords(recs));
                      }}
                    >
                      <Pencil className="h-4 w-4" /> Modifica orari
                    </button>
                  ) : (
                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-on-surface flex items-center gap-1.5">
                        <Pencil className="h-4 w-4" /> Modifica registrazioni
                      </h4>
                      <div className="space-y-2">
                        {editingRecords.map((rec, i) => (
                          <div key={rec.id} className="flex items-center gap-2">
                            <select
                              value={rec.type}
                              onChange={(e) => {
                                const updated = [...editingRecords];
                                updated[i] = { ...rec, type: e.target.value };
                                setEditingRecords(updated);
                              }}
                              className="rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs font-medium text-on-surface"
                            >
                              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                            <input
                              type="time"
                              value={rec.declaredTime}
                              onChange={(e) => {
                                const updated = [...editingRecords];
                                updated[i] = { ...rec, declaredTime: e.target.value };
                                setEditingRecords(updated);
                              }}
                              className="rounded-md border border-outline-variant bg-surface-container-lowest px-2 py-1.5 text-xs tabular-nums text-on-surface"
                            />
                            <span className="text-[10px] text-outline-variant">{TYPE_LABELS[rec.type] || rec.type}</span>
                            <button
                              title="Elimina record"
                              className="ml-auto rounded-full p-1 text-outline-variant hover:bg-error/10 hover:text-error transition-colors"
                              onClick={() => {
                                if (!confirm("Eliminare questa registrazione?")) return;
                                fetch(`/api/records/${rec.id}`, { method: "DELETE" })
                                  .then(() => {
                                    setEditingRecords(editingRecords.filter((_, j) => j !== i));
                                  });
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
                          disabled={savingRecords}
                          onClick={async () => {
                            setSavingRecords(true);
                            try {
                              await Promise.all(
                                editingRecords.map((rec) =>
                                  fetch(`/api/records/${rec.id}`, {
                                    method: "PUT",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ type: rec.type, declaredTime: rec.declaredTime }),
                                  })
                                )
                              );
                              setEditingRecords(null);
                              load();
                            } finally {
                              setSavingRecords(false);
                            }
                          }}
                        >
                          <Save className="h-3.5 w-3.5" /> Salva modifiche
                        </button>
                        <button
                          className="flex items-center gap-1.5 rounded-lg border border-outline-variant px-4 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-low transition-colors"
                          onClick={() => setEditingRecords(null)}
                        >
                          Annulla
                        </button>
                        <button
                          className="flex items-center gap-1.5 rounded-lg border border-dashed border-outline-variant px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-low transition-colors ml-auto"
                          onClick={() => {
                            fetch("/api/records", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                employeeId: selectedDay.employeeId,
                                date: selectedDay.date,
                                type: "ENTRY",
                                declaredTime: "09:00",
                              }),
                            })
                              .then((r) => r.json())
                              .then((newRec) => {
                                setEditingRecords([...editingRecords, { id: newRec.id, type: newRec.type, declaredTime: newRec.declaredTime }]);
                              });
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" /> Aggiungi
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Overtime history table */}
          {(() => {
            const overtimeDays = data
              .filter((d) => d.overtime > 0)
              .sort((a, b) => a.date.localeCompare(b.date));
            if (overtimeDays.length === 0) return null;
            const totalOTMinutes = overtimeDays.reduce((s, d) => s + Math.round(d.overtime * 60), 0);
            return (
              <div className="rounded-lg bg-surface-container-lowest shadow-card overflow-hidden">
                <div className="border-b border-surface-container bg-surface-container-low px-6 py-4">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-on-surface">
                      <Flame className="h-5 w-5 text-orange-500" />
                      Storico Straordinari — {MONTH_NAMES[m - 1]} {y}
                    </h3>
                    <span className="rounded-full bg-primary-fixed px-3 py-1 text-sm font-bold tabular-nums text-primary">
                      Totale: {minutesToHHMM(totalOTMinutes)}
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-surface-container bg-surface-container-low/50">
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Data</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Mattina</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Pomeriggio</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Ore lavorate</th>
                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface-variant">Straordinario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overtimeDays.map((d) => {
                        const otMinutes = Math.round(d.overtime * 60);
                        const morning = d.entries[0] || d.exits[0]
                          ? `${d.entries[0] ?? "?"} – ${d.exits[0] ?? "?"}`
                          : "-";
                        const afternoon = d.entries[1] || d.exits[1]
                          ? `${d.entries[1] ?? "?"} – ${d.exits[1] ?? "?"}`
                          : "-";
                        return (
                          <tr
                            key={d.date}
                            className="border-b border-surface-container transition-colors hover:bg-surface-container-low/50 cursor-pointer"
                            onClick={() => { setSelectedDay(d); setEditingRecords(null); }}
                          >
                            <td className="px-4 py-3 font-medium text-on-surface">{formatDate(d.date)}</td>
                            <td className="px-4 py-3 tabular-nums text-on-surface">{morning}</td>
                            <td className="px-4 py-3 tabular-nums text-on-surface">{afternoon}</td>
                            <td className="px-4 py-3 tabular-nums font-medium text-on-surface">{hoursToHHMM(d.hoursWorked)}</td>
                            <td className="px-4 py-3 tabular-nums font-bold text-primary">+{minutesToHHMM(otMinutes)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon, color = "text-on-surface" }: { label: string; value: string; icon: ReactNode; color?: string }) {
  return (
    <div className="rounded-lg bg-surface-container-lowest p-3 shadow-card">
      <div className="flex items-center gap-2 text-xs text-on-surface-variant">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function DetailCard({ icon, label, value, color, highlight }: { icon: ReactNode; label: string; value: string; color?: string; highlight?: boolean }) {
  const colorClass = color === "purple" ? "text-tertiary" : color === "yellow" ? "text-warning" : color === "blue" ? "text-primary" : "text-on-surface";
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-primary-fixed/10 ring-1 ring-primary/20" : "bg-surface-container-low"}`}>
      <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
        {icon} {label}
      </div>
      <div className={`mt-1 text-sm font-semibold tabular-nums ${colorClass}`}>{value}</div>
    </div>
  );
}
