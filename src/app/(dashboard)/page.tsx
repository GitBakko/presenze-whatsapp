"use client";

import { useEffect, useState, useMemo } from "react";
import { AttendanceTable } from "@/components/AttendanceTable";
import { WeeklyHoursChart } from "@/components/Charts";
import { DateRangePicker } from "@/components/DateRangePicker";
import { hoursToHHMM, formatDate } from "@/lib/formatTime";
import {
  UserCheck, UserX, Briefcase, Clock,
  BarChart3, Gauge, TimerOff, Crown,
  ShieldCheck, Hourglass, CalendarX,
  Coffee, CircleOff,
  Bug, AlertTriangle, CircleAlert, ListChecks,
  CalendarDays, Timer, ChevronLeft, ChevronRight,
} from "lucide-react";
import type { ReactNode } from "react";

interface DashboardData {
  today: {
    totalEmployees: number;
    present: number;
    absent: number;
    stillWorking: number;
    delays: number;
    anomalies: number;
  };
  period: {
    totalHours: number;
    avgHours: number;
    totalOvertime: number;
    topOvertimeEmployee: { name: string; hours: number } | null;
    totalDelays: number;
    punctualityRate: number;
    avgDelayMinutes: number;
    daysWithoutPause: number;
    avgPauseMinutes: number;
  };
  anomalies: {
    open: number;
    total: number;
    resolutionRate: number;
  };
  chartData: { name: string; oreMedia: number; pausaMedia: number; straordinarioMedia: number }[];
  refDate: string;
  availableDates: string[];
  todayStats: {
    employeeId: string;
    employeeName: string;
    date: string;
    entries: string[];
    exits: string[];
    hoursWorked: number;
    hoursWorkedMsg: number;
    pauseMinutes: number;
    morningDelay: number;
    afternoonDelay: number;
    overtime: number;
    hasAnomaly: boolean;
    anomalies: { type: string; description: string }[];
  }[];
}

/* ── Helpers ── */

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function weekAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split("T")[0];
}

/* ── Tiny KPI card used inside grid sections ── */
function Kpi({
  icon,
  label,
  value,
  sub,
  accent = "primary",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: "primary" | "success" | "warning" | "error";
}) {
  const iconBg: Record<string, string> = {
    primary: "bg-primary-fixed text-primary",
    success: "bg-success-container text-success",
    warning: "bg-warning-container text-warning",
    error: "bg-error-container text-error",
  };
  const borderColor: Record<string, string> = {
    primary: "border-primary/30",
    success: "border-success/30",
    warning: "border-warning/30",
    error: "border-error/30",
  };

  return (
    <div
      className={`flex items-start gap-4 rounded-lg border bg-surface-container-lowest p-5 shadow-card ${borderColor[accent]}`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg[accent]}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-secondary">
          {label}
        </p>
        <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-primary">
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 text-xs text-on-surface-variant">{sub}</p>
        )}
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
}: {
  icon: ReactNode;
  title: string;
}) {
  return (
    <h2 className="flex items-center gap-2 font-display text-lg font-bold text-primary">
      {icon}
      {title}
    </h2>
  );
}

/* ── Page ── */

export default function DashboardPage() {
  const [dateFrom, setDateFrom] = useState(weekAgoStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refDate, setRefDate] = useState<string | null>(null); // null = default (last registered)

  const availableDateSet = useMemo(
    () => new Set(data?.availableDates ?? []),
    [data?.availableDates]
  );

  // Selected date for the attendance panel (from API default or user pick)
  const selectedDate = refDate ?? data?.refDate ?? todayStr();

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ from: dateFrom, to: dateTo });
    if (refDate) params.set("refDate", refDate);
    fetch(`/api/dashboard?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, refDate]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-primary">
            Dashboard
          </h1>
          <p className="mt-1 text-secondary">
            Panoramica presenze e attività del personale.
          </p>
        </div>
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => {
            setDateFrom(f);
            setDateTo(t);
          }}
        />
      </div>

      {loading || !data ? (
        <div className="flex h-64 items-center justify-center text-on-surface-variant">
          Caricamento...
        </div>
      ) : (
        <>
          {/* ════════ OGGI ════════ */}
          <section className="space-y-4">
            <SectionHeading icon={<CalendarDays className="h-5 w-5 text-blue-500" />} title="Oggi" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                icon={<UserCheck className="h-5 w-5" />}
                label="Presenti"
                value={`${data.today.present}/${data.today.totalEmployees}`}
                sub={`${data.today.totalEmployees > 0 ? Math.round((data.today.present / data.today.totalEmployees) * 100) : 0}% del team`}
                accent="success"
              />
              <Kpi
                icon={<UserX className="h-5 w-5" />}
                label="Assenti"
                value={data.today.absent}
                sub={data.today.absent === 0 ? "Tutti presenti" : undefined}
                accent={data.today.absent > 0 ? "warning" : "success"}
              />
              <Kpi
                icon={<Briefcase className="h-5 w-5" />}
                label="Ancora in servizio"
                value={data.today.stillWorking}
                sub="Entrati ma non usciti"
                accent="primary"
              />
              <Kpi
                icon={<Clock className="h-5 w-5" />}
                label="Ritardi oggi"
                value={data.today.delays}
                sub={data.today.delays === 0 ? "Tutti puntuali" : undefined}
                accent={data.today.delays > 0 ? "warning" : "success"}
              />
            </div>
          </section>

          {/* ════════ ORE & STRAORDINARI ════════ */}
          <section className="space-y-4">
            <SectionHeading icon={<Timer className="h-5 w-5 text-indigo-500" />} title="Ore &amp; Straordinari (periodo)" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                icon={<BarChart3 className="h-5 w-5" />}
                label="Monte ore totale"
                value={hoursToHHMM(data.period.totalHours)}
                sub="Ore lavorate nel periodo"
                accent="primary"
              />
              <Kpi
                icon={<Gauge className="h-5 w-5" />}
                label="Ore medie / giorno"
                value={hoursToHHMM(data.period.avgHours)}
                sub="Media per dipendente-giorno"
                accent="primary"
              />
              <Kpi
                icon={<TimerOff className="h-5 w-5" />}
                label="Straordinari totali"
                value={hoursToHHMM(data.period.totalOvertime)}
                sub={
                  data.period.topOvertimeEmployee
                    ? `Top: ${data.period.topOvertimeEmployee.name} (${hoursToHHMM(data.period.topOvertimeEmployee.hours)})`
                    : "Nessuno straordinario"
                }
                accent={data.period.totalOvertime > 0 ? "warning" : "primary"}
              />
              <Kpi
                icon={<Crown className="h-5 w-5" />}
                label="Top straordinari"
                value={data.period.topOvertimeEmployee?.name ?? "—"}
                sub={
                  data.period.topOvertimeEmployee
                    ? `${hoursToHHMM(data.period.topOvertimeEmployee.hours)} di straordinario`
                    : "Nessuno nel periodo"
                }
                accent="warning"
              />
            </div>
          </section>

          {/* ════════ RITARDI & PUNTUALITÀ ════════ */}
          <section className="space-y-4">
            <SectionHeading icon={<Gauge className="h-5 w-5 text-amber-500" />} title="Ritardi &amp; Puntualità (periodo)" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Kpi
                icon={<ShieldCheck className="h-5 w-5" />}
                label="Tasso di puntualità"
                value={`${data.period.punctualityRate}%`}
                sub={`${data.period.totalDelays} giorni con ritardo`}
                accent={data.period.punctualityRate >= 90 ? "success" : "warning"}
              />
              <Kpi
                icon={<Hourglass className="h-5 w-5" />}
                label="Ritardo medio"
                value={data.period.avgDelayMinutes > 0 ? `${data.period.avgDelayMinutes} min` : "—"}
                sub="Quando c'è ritardo"
                accent={data.period.avgDelayMinutes > 15 ? "error" : "primary"}
              />
              <Kpi
                icon={<CalendarX className="h-5 w-5" />}
                label="Giorni con ritardo"
                value={data.period.totalDelays}
                sub="Nel periodo selezionato"
                accent={data.period.totalDelays > 0 ? "warning" : "success"}
              />
            </div>
          </section>

          {/* ════════ PAUSE ════════ */}
          <section className="space-y-4">
            <SectionHeading icon={<Coffee className="h-5 w-5 text-teal-600" />} title="Pause (periodo)" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Kpi
                icon={<Coffee className="h-5 w-5" />}
                label="Pausa media"
                value={data.period.avgPauseMinutes > 0 ? `${data.period.avgPauseMinutes} min` : "—"}
                sub="Durata media per giorno"
                accent="primary"
              />
              <Kpi
                icon={<CircleOff className="h-5 w-5" />}
                label="Giorni senza pausa"
                value={data.period.daysWithoutPause}
                sub={data.period.daysWithoutPause === 0 ? "Tutti fanno pausa" : "Attenzione al benessere"}
                accent={data.period.daysWithoutPause > 0 ? "warning" : "success"}
              />
            </div>
          </section>

          {/* ════════ ANOMALIE & QUALITÀ DATI ════════ */}
          <section className="space-y-4">
            <SectionHeading icon={<Bug className="h-5 w-5 text-rose-500" />} title="Anomalie &amp; Qualità Dati" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Kpi
                icon={<AlertTriangle className="h-5 w-5" />}
                label="Anomalie oggi"
                value={data.today.anomalies}
                accent={data.today.anomalies > 0 ? "error" : "success"}
              />
              <Kpi
                icon={<CircleAlert className="h-5 w-5" />}
                label="Anomalie aperte"
                value={data.anomalies.open}
                sub={`su ${data.anomalies.total} totali`}
                accent={data.anomalies.open > 0 ? "error" : "success"}
              />
              <Kpi
                icon={<ListChecks className="h-5 w-5" />}
                label="Tasso risoluzione"
                value={`${data.anomalies.resolutionRate}%`}
                sub={data.anomalies.total > 0 ? `${data.anomalies.total - data.anomalies.open}/${data.anomalies.total} risolte` : "Nessuna anomalia"}
                accent={data.anomalies.resolutionRate >= 80 ? "success" : "warning"}
              />
            </div>
          </section>

          {/* ════════ CHART ════════ */}
          <WeeklyHoursChart data={data.chartData} />

          {/* ════════ TABLE ════════ */}
          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-display text-xl font-bold text-primary">
                Presenze del {formatDate(selectedDate)}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const dates = data?.availableDates ?? [];
                    const idx = dates.indexOf(selectedDate);
                    if (idx >= 0 && idx < dates.length - 1) setRefDate(dates[idx + 1]);
                  }}
                  disabled={!data?.availableDates || data.availableDates.indexOf(selectedDate) >= data.availableDates.length - 1}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Giorno precedente"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (availableDateSet.has(e.target.value)) setRefDate(e.target.value);
                  }}
                  className="h-9 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 text-sm tabular-nums text-on-surface focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const dates = data?.availableDates ?? [];
                    const idx = dates.indexOf(selectedDate);
                    if (idx > 0) setRefDate(dates[idx - 1]);
                  }}
                  disabled={!data?.availableDates || data.availableDates.indexOf(selectedDate) <= 0}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Giorno successivo"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <AttendanceTable data={data.todayStats} />
          </div>
        </>
      )}
    </div>
  );
}
