"use client";

import Link from "next/link";
import { AlertTriangle, HelpCircle, RefreshCw } from "lucide-react";
import type { AnomalyRecent } from "@/types/dashboard";

const SEVERITY_STYLE: Record<number, { bg: string; text: string }> = {
  2: { bg: "bg-red-100", text: "text-red-800" },
  1: { bg: "bg-amber-100", text: "text-amber-800" },
  0: { bg: "bg-blue-100", text: "text-blue-800" },
};

function relativeDate(dateStr: string): string {
  const today = new Date().toISOString().split("T")[0];
  if (dateStr === today) return "oggi";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === yesterday.toISOString().split("T")[0]) return "ieri";
  const [, m, d] = dateStr.split("-");
  return `${parseInt(d)}/${parseInt(m)}`;
}

function typeIcon(type: string) {
  if (type.includes("MISSING")) return HelpCircle;
  if (type.includes("MISMATCH")) return RefreshCw;
  return AlertTriangle;
}

export function AnomalyList({ anomalies }: { anomalies: AnomalyRecent[] }) {
  return (
    <div className="rounded-xl border border-gray-200/60 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Anomalie recenti
        </h3>
        <Link
          href="/anomalies"
          className="text-xs font-medium text-primary hover:underline"
        >
          Tutte le anomalie →
        </Link>
      </div>
      {anomalies.length === 0 ? (
        <div className="py-8 text-center text-xs text-gray-400">
          Nessuna anomalia aperta
        </div>
      ) : (
        <div className="space-y-2.5">
          {anomalies.map((a) => {
            const sev = SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE[0];
            const Icon = typeIcon(a.type);
            return (
              <div
                key={a.id}
                className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-gray-50"
              >
                <span
                  className={`mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${sev.bg}`}
                >
                  <Icon className={`h-3.5 w-3.5 ${sev.text}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">
                    {a.employeeName}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {a.description}
                  </p>
                </div>
                <span className="flex-shrink-0 text-[11px] text-gray-400">
                  {relativeDate(a.date)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
