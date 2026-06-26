"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { MonteTrend } from "@/types/dashboard";

/** Distinct, reasonably color-blind-friendly hues for the per-employee lines. */
const PALETTE = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed",
  "#0891b2", "#db2777", "#4d7c0f", "#ea580c", "#4f46e5",
  "#0d9488", "#b91c1c",
];
const TOTAL_KEY = "Totale azienda";

export function MonteTrendChart({
  data,
  title = "Andamento monte ferie/permessi",
  height = 300,
}: {
  data: MonteTrend;
  title?: string;
  height?: number;
}) {
  // Default: company total visible, individual employees hidden (toggle to add).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(data.series.map((s) => s.name)));

  const rows = useMemo(
    () =>
      data.months.map((mese, i) => {
        const row: Record<string, number | string | null> = { mese };
        for (const s of data.series) row[s.name] = s.points[i];
        row[TOTAL_KEY] = data.total[i] ?? null;
        return row;
      }),
    [data],
  );

  if (data.months.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h3 className="mb-2 text-sm font-semibold text-on-surface">{title}</h3>
        <div className="flex h-48 items-center justify-center text-sm text-on-surface-variant">
          Nessun dato disponibile
        </div>
      </div>
    );
  }

  const toggle = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const onlyTotal = () => setHidden(new Set(data.series.map((s) => s.name)));
  const showAll = () => setHidden(new Set());

  const totalHidden = hidden.has(TOTAL_KEY);

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={onlyTotal}
            className="rounded-lg bg-surface-container px-2.5 py-1 font-medium text-on-surface-variant hover:bg-surface-container-high"
          >
            Solo totale
          </button>
          <button
            type="button"
            onClick={showAll}
            className="rounded-lg bg-surface-container px-2.5 py-1 font-medium text-on-surface-variant hover:bg-surface-container-high"
          >
            Tutti
          </button>
        </div>
      </div>

      <div aria-label="Grafico andamento mensile del monte ferie e permessi in giorni">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-container)" />
            <XAxis
              dataKey="mese"
              tick={{ fontSize: 11, fill: "var(--color-on-surface-variant)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--color-on-surface-variant)" }}
              axisLine={false}
              tickLine={false}
              width={44}
              label={{ value: "giorni", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "var(--color-on-surface-variant)" } }}
            />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: "1px solid var(--color-outline-variant)", fontSize: 12 }}
              formatter={(value, name) => [`${value} gg`, name]}
            />
            {!totalHidden && (
              <Line
                type="monotone"
                dataKey={TOTAL_KEY}
                stroke="var(--color-primary)"
                strokeWidth={3}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
            {data.series.map((s, idx) =>
              hidden.has(s.name) ? null : (
                <Line
                  key={s.employeeId}
                  type="monotone"
                  dataKey={s.name}
                  stroke={PALETTE[idx % PALETTE.length]}
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Filtri serie */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <FilterChip
          label={TOTAL_KEY}
          color="var(--color-primary)"
          active={!totalHidden}
          onClick={() => toggle(TOTAL_KEY)}
        />
        {data.series.map((s, idx) => (
          <FilterChip
            key={s.employeeId}
            label={s.name}
            color={PALETTE[idx % PALETTE.length]}
            active={!hidden.has(s.name)}
            onClick={() => toggle(s.name)}
          />
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "border-outline-variant/40 bg-surface-container text-on-surface"
          : "border-transparent bg-surface-container-low text-on-surface-variant/50 line-through"
      }`}
    >
      <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: active ? color : "var(--color-outline-variant)" }} />
      {label}
    </button>
  );
}
