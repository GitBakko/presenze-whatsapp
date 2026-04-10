"use client";

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
import type { OreChartPoint } from "@/types/dashboard";

export function OreChart({ data }: { data: OreChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        Nessun dato disponibile
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200/60 bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">
        Ore lavorate vs contratto
      </h3>
      <div aria-label="Grafico ore lavorate vs contratto mensile">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} barGap={2} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="mese"
              tick={{ fontSize: 11, fill: "#888" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#888" }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e5e5e5",
                fontSize: 12,
              }}
              formatter={(value, name) => [
                `${value} h`,
                name === "contratto" ? "Ore contratto" : "Ore lavorate",
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              formatter={(v: string) =>
                v === "contratto" ? "Contratto" : "Lavorate"
              }
            />
            <Bar dataKey="contratto" fill="#B4B2A9" radius={[3, 3, 0, 0]} />
            <Bar dataKey="lavorate" fill="#378ADD" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
