"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface ChartData {
  name: string;
  oreMedia: number;
  pausaMedia: number;
  straordinarioMedia: number;
}

/** Resolve CSS custom properties from :root so Recharts SVG attributes stay in sync with the design-system. */
function useTokenColors() {
  return useMemo(() => {
    if (typeof window === "undefined") {
      return { primary: "#004253", accent: "#3a9ab5", warning: "#c77d00", grid: "#edeeef", muted: "#6f797c" };
    }
    const s = getComputedStyle(document.documentElement);
    const get = (v: string, fallback: string) => s.getPropertyValue(v).trim() || fallback;
    return {
      primary: get("--color-primary", "#004253"),
      accent: get("--color-primary-container", "#3a9ab5"),
      warning: get("--color-warning", "#c77d00"),
      grid: get("--color-surface-container", "#edeeef"),
      muted: get("--color-outline", "#6f797c"),
    };
  }, []);
}

export function WeeklyHoursChart({ data }: { data: ChartData[] }) {
  const colors = useTokenColors();
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg bg-surface-container-lowest text-on-surface-variant shadow-card">
        Nessun dato disponibile per il grafico
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-surface-container-lowest p-6 shadow-card">
      <h3 className="mb-6 font-display text-lg font-bold text-primary" style={{ textWrap: "balance" }}>
        Medie Giornaliere per Dipendente
      </h3>
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={data} barGap={2} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: colors.muted }}
            axisLine={false}
            tickLine={false}
          />
          {/* Left axis — hours */}
          <YAxis
            yAxisId="hours"
            tick={{ fontSize: 11, fill: colors.primary }}
            axisLine={false}
            tickLine={false}
            unit="h"
            label={{
              value: "Ore",
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 10, fill: colors.primary },
            }}
          />
          {/* Right axis — minutes */}
          <YAxis
            yAxisId="minutes"
            orientation="right"
            tick={{ fontSize: 11, fill: colors.muted }}
            axisLine={false}
            tickLine={false}
            unit="m"
            label={{
              value: "Minuti",
              angle: 90,
              position: "insideRight",
              style: { fontSize: 10, fill: colors.muted },
            }}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "none",
              boxShadow: "0 8px 24px rgba(25,28,29,0.08)",
              fontFamily: "Inter",
              fontSize: 12,
            }}
            formatter={(value, name) => {
              if (name === "Ore Medie") return [`${value} h`, name];
              return [`${value} min`, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, fontFamily: "Inter" }} />
          <Bar
            yAxisId="hours"
            dataKey="oreMedia"
            name="Ore Medie"
            fill={colors.primary}
            radius={[4, 4, 0, 0]}
            barSize={28}
          />
          <Bar
            yAxisId="minutes"
            dataKey="pausaMedia"
            name="Pausa Media"
            fill={colors.accent}
            radius={[4, 4, 0, 0]}
            barSize={28}
          />
          <Bar
            yAxisId="minutes"
            dataKey="straordinarioMedia"
            name="Straordinario Medio"
            fill={colors.warning}
            radius={[4, 4, 0, 0]}
            barSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
