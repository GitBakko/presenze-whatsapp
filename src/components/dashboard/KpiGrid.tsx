"use client";

import { useSession } from "next-auth/react";
import { StatCard } from "./StatCard";
import type { DashboardStatsResponse } from "@/types/dashboard";

export function KpiGrid({ kpi }: { kpi: DashboardStatsResponse["kpi"] }) {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label="Tasso presenza"
        value={`${kpi.tassoPresenza.value}%`}
        delta={kpi.tassoPresenza.delta}
        color="green"
        barPercent={kpi.tassoPresenza.value}
      />
      <StatCard
        label="Puntualità"
        value={`${kpi.tassoPuntualita.value}%`}
        delta={kpi.tassoPuntualita.delta}
        color="blue"
        barPercent={kpi.tassoPuntualita.value}
      />
      <StatCard
        label="Ritardo medio"
        value={`${kpi.ritardoMedioMin.value} min`}
        delta={kpi.ritardoMedioMin.delta}
        deltaInverted
        color="blue"
      />
      {isAdmin && (
        <StatCard
          label="Assenteismo"
          value={`${kpi.tassoAssenteismo.value}%`}
          delta={kpi.tassoAssenteismo.delta}
          deltaInverted
          color="red"
          barPercent={kpi.tassoAssenteismo.value}
        />
      )}
      <StatCard
        label="Straordinario totale"
        value={`${kpi.oreStraordTotali.value} h`}
        delta={kpi.oreStraordTotali.delta}
        color="amber"
      />
      <StatCard
        label={isAdmin ? "Ore medie / dip" : "Ore lavorate"}
        value={`${kpi.oreLavorateMediaDip.value} h`}
        delta={kpi.oreLavorateMediaDip.delta}
        color="gray"
      />
      <StatCard
        label="Giorni malattia"
        value={`${kpi.giorniMalattia.value}`}
        delta={kpi.giorniMalattia.delta}
        deltaInverted
        color="red"
      />
      {isAdmin && (
        <StatCard
          label="Anomalie risolte"
          value={`${kpi.percAnomalieRisolte.value}%`}
          delta={kpi.percAnomalieRisolte.delta}
          color="green"
          barPercent={kpi.percAnomalieRisolte.value}
        />
      )}
    </div>
  );
}
