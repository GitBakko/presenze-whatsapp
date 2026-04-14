"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { RefreshCw, PartyPopper, CalendarOff } from "lucide-react";
import { DashboardPeriodFilter } from "@/components/dashboard/DashboardPeriodFilter";
import { TodayOverview } from "@/components/dashboard/TodayOverview";
import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { OreChart } from "@/components/dashboard/OreChart";
import { AssenzeChart } from "@/components/dashboard/AssenzeChart";
import { EmployeeStatusList } from "@/components/dashboard/EmployeeStatusList";
import { AnomalyList } from "@/components/dashboard/AnomalyList";
import { LeaveBalanceTable } from "@/components/dashboard/LeaveBalanceTable";
import { useNotificationsContext } from "@/components/NotificationsProvider";
import type { DashboardPeriod, DashboardStatsResponse } from "@/types/dashboard";

export default function DashboardPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const [data, setData] = useState<DashboardStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stats/dashboard?period=${period}&chart=all`
      );
      if (!res.ok) {
        setError(`Errore ${res.status}`);
        return;
      }
      setData(await res.json());
    } catch {
      setError("Errore di rete");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Live refresh via WebSocket notifications ──────────────────────
  // Quando arriva un punch (notifica real-time dal kiosk/bot), rifacciamo
  // il fetch. Usiamo lastEvent.id come trigger: cambia ad ogni nuovo evento.
  const { lastEvent } = useNotificationsContext();
  useEffect(() => {
    if (lastEvent) {
      // Aspetta 1s per dare tempo al server di persistere il record
      const t = setTimeout(load, 1000);
      return () => clearTimeout(t);
    }
  }, [lastEvent, load]);

  const todayFormatted = new Date().toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* ── TOPBAR ─────────────────────────────────────────────── */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-primary">
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm capitalize text-on-surface-variant">
            {todayFormatted}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DashboardPeriodFilter value={period} onChange={setPeriod} />
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50 disabled:cursor-not-allowed"
            title="Aggiorna dati"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Error banner ────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{error}</span>
          <button
            onClick={load}
            className="ml-4 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-200"
          >
            Riprova
          </button>
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────── */}
      {loading && !data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-surface-container" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-container" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="h-80 animate-pulse rounded-xl bg-surface-container lg:col-span-2" />
            <div className="h-80 animate-pulse rounded-xl bg-surface-container" />
          </div>
        </div>
      )}

      {/* ── Data loaded ──────────────────────────────────────────── */}
      {data && (
        <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>

        <>
          {/* Banner giorno non lavorativo */}
          {data.isNonWorkingToday && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-4">
              {data.nonWorkingLabel === "Sabato" || data.nonWorkingLabel === "Domenica" ? (
                <CalendarOff className="h-8 w-8 flex-shrink-0 text-blue-500" />
              ) : (
                <PartyPopper className="h-8 w-8 flex-shrink-0 text-indigo-500" />
              )}
              <div>
                <p className="text-sm font-bold text-blue-900">
                  {data.nonWorkingLabel === "Sabato" || data.nonWorkingLabel === "Domenica"
                    ? `Oggi è ${data.nonWorkingLabel}`
                    : `Oggi è festa: ${data.nonWorkingLabel}`}
                </p>
                <p className="text-xs text-blue-700">
                  {data.nonWorkingLabel === "Sabato" || data.nonWorkingLabel === "Domenica"
                    ? "Giorno non lavorativo — i dati di presenza e assenza non sono rilevanti."
                    : "Giornata festiva nazionale — l'ufficio è chiuso. Buona festa! 🎉"}
                </p>
              </div>
            </div>
          )}

          {/* SEZIONE A — Riepilogo Oggi (solo admin) */}
          {isAdmin && <TodayOverview data={data.today} />}

          {/* SEZIONE B — KPI */}
          <KpiGrid kpi={data.kpi} />

          {/* SEZIONE C — Grafici */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <OreChart data={data.charts?.oreMensili ?? []} />
            </div>
            <div>
              <AssenzeChart data={data.charts?.assenzeTipologia ?? []} />
            </div>
          </div>

          {/* SEZIONE D — Dipendenti + Anomalie (solo admin) */}
          {isAdmin && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <EmployeeStatusList employees={data.employeesToday} />
              <AnomalyList anomalies={data.anomalieRecenti} />
            </div>
          )}

          {/* SEZIONE E — Saldi ferie */}
          <LeaveBalanceTable rows={data.leaveBalances} />
        </>
        </div>
      )}
    </div>
  );
}
