"use client";

import Link from "next/link";
import { AlertTriangle, HelpCircle, RefreshCw } from "lucide-react";
import type { AnomalyRecent } from "@/types/dashboard";

const SEVERITY_STYLE: Record<number, { bg: string; text: string }> = {
  2: { bg: "bg-error-container", text: "text-on-error-container" },
  1: { bg: "bg-warning-container/40", text: "text-warning" },
  0: { bg: "bg-primary-container/40", text: "text-on-primary-container" },
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
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-on-surface">
          Anomalie da verificare
        </h3>
        <Link
          href="/anomalies"
          className="text-xs font-medium text-primary hover:underline"
        >
          Tutte le anomalie →
        </Link>
      </div>
      {anomalies.length === 0 ? (
        <div className="py-8 text-center text-xs text-on-surface-variant">
          Nessuna anomalia aperta
        </div>
      ) : (
        <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          {anomalies.map((a) => {
            const sev = SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE[0];
            const Icon = typeIcon(a.type);
            return (
              <div
                key={a.id}
                className="rounded-xl border border-outline-variant/20 bg-surface-container-low/50 p-3"
              >
                <p className="truncate text-sm font-bold text-on-surface">
                  {a.employeeName}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${sev.bg}`}
                  >
                    <Icon className={`h-3 w-3 ${sev.text}`} />
                  </span>
                  <span className="text-xs text-on-surface-variant">{relativeDate(a.date)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-on-surface-variant">
                  {a.description}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
