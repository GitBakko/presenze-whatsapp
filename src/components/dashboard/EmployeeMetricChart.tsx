"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import type { EmployeeMetricPoint } from "@/types/dashboard";
import { getShortName } from "@/lib/avatar-utils";

function formatMinutes(min: number): string {
  if (min === 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h e ${m}m`;
}

export function EmployeeMetricChart({
  title,
  data,
  color,
  emptyMessage,
}: {
  title: string;
  data: EmployeeMetricPoint[];
  color: string;
  emptyMessage: string;
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h3 className="mb-4 text-sm font-semibold text-on-surface">{title}</h3>
        <div className="flex h-32 items-center justify-center text-sm text-on-surface-variant">
          {emptyMessage}
        </div>
      </div>
    );
  }

  const allNames = data.map((d) => d.employeeName);
  const chartData = data.map((d) => ({
    name: getShortName(d.employeeName, allNames),
    fullName: d.employeeName,
    total: d.totalMinutes,
    avg: d.avgMinutes,
    days: d.days,
    label: formatMinutes(d.totalMinutes),
    avgLabel: formatMinutes(d.avgMinutes),
  }));

  const barHeight = 36;
  const chartHeight = Math.max(120, chartData.length * barHeight + 40);

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5">
      <h3 className="mb-4 text-sm font-semibold text-on-surface">{title}</h3>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ left: 0, right: 80, top: 0, bottom: 0 }}
          barSize={20}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: "var(--color-on-surface-variant)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => formatMinutes(v)}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "var(--color-on-surface-variant)" }}
            axisLine={false}
            tickLine={false}
            width={70}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid var(--color-outline-variant)",
              fontSize: 12,
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(_value: any, _name: any, props: any) => {
              const d = props.payload;
              return [
                `Totale: ${d.label} (${d.days} gg) · Media: ${d.avgLabel}/gg`,
                d.fullName,
              ];
            }}
          />
          <Bar dataKey="total" radius={[0, 4, 4, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={color} />
            ))}
            <LabelList
              dataKey="avgLabel"
              position="right"
              style={{ fontSize: 10, fill: "var(--color-on-surface-variant)" }}
              formatter={(v: unknown) => `media ${v}`}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
