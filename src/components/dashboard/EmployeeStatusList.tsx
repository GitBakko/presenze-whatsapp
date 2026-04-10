"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { EmployeeTodayStatus, EmployeeStatus } from "@/types/dashboard";

const STATUS_DOT: Record<EmployeeStatus, string> = {
  present: "bg-green-500",
  late: "bg-amber-500",
  absent: "bg-red-500",
  sick: "bg-red-400",
  vacation: "bg-gray-400",
};

const AVATAR_COLORS = [
  "from-blue-500 to-blue-600",
  "from-emerald-500 to-emerald-600",
  "from-violet-500 to-violet-600",
  "from-amber-500 to-amber-600",
  "from-rose-500 to-rose-600",
  "from-cyan-500 to-cyan-600",
  "from-indigo-500 to-indigo-600",
  "from-teal-500 to-teal-600",
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function EmployeeStatusList({
  employees,
}: {
  employees: EmployeeTodayStatus[];
}) {
  const shown = employees.slice(0, 8);
  const remaining = employees.length - shown.length;

  return (
    <div className="rounded-xl border border-gray-200/60 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Dipendenti — stato oggi
        </h3>
        <Link
          href="/employees"
          className="text-xs font-medium text-primary hover:underline"
        >
          {remaining > 0 ? `+${remaining} altri →` : "Vedi tutti →"}
        </Link>
      </div>
      <div className="space-y-2">
        {shown.map((emp) => {
          const initials = emp.name
            .split(" ")
            .map((w) => w[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
          const colorIdx = hashName(emp.name) % AVATAR_COLORS.length;

          return (
            <div
              key={emp.id}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50"
            >
              {/* Status dot */}
              <span
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${STATUS_DOT[emp.status]}`}
              />
              {/* Avatar */}
              {emp.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={emp.avatarUrl}
                  alt={emp.name}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${AVATAR_COLORS[colorIdx]} text-xs font-bold text-white`}
                >
                  {initials}
                </div>
              )}
              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800">
                  {emp.name}
                </p>
                <p className="text-[11px] text-gray-500">
                  {emp.label
                    ? emp.label
                    : emp.entryTime
                    ? `Entrata ${emp.entryTime}`
                    : "Non registrato"}
                </p>
              </div>
              {/* Delay warning */}
              {emp.delayMinutes > 15 && (
                <div className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  +{emp.delayMinutes}&apos;
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
