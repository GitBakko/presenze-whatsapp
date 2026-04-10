"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { AssenzaChartPoint } from "@/types/dashboard";

export function AssenzeChart({ data }: { data: AssenzaChartPoint[] }) {
  const totalGiorni = data.reduce((s, d) => s + d.giorni, 0);

  if (data.length === 0 || totalGiorni === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Nessuna assenza nel periodo
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200/60 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">
        Assenze per tipologia
      </h3>
      <div aria-label="Grafico assenze per tipologia" className="relative">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              dataKey="giorni"
              nameKey="tipo"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.colore} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e5e5e5",
                fontSize: 12,
              }}
              formatter={(value, name) => [
                `${value} gg`,
                String(name),
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Centro donut */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-800">{totalGiorni}</p>
            <p className="text-[10px] text-gray-400">giorni</p>
          </div>
        </div>
      </div>
      {/* Legenda inline */}
      <div className="mt-3 flex flex-wrap justify-center gap-3">
        {data.map((d) => (
          <div key={d.tipo} className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: d.colore }}
            />
            {d.tipo} ({d.giorni})
          </div>
        ))}
      </div>
    </div>
  );
}
