"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { EmployeeTodayStatus, EmployeeStatus } from "@/types/dashboard";
import { getInitials, getAvatarColor } from "@/lib/avatar-utils";

const STATUS_DOT: Record<EmployeeStatus, string> = {
  present: "bg-green-500",
  late: "bg-amber-500",
  absent: "bg-red-500",
  sick: "bg-red-400",
  vacation: "bg-outline-variant",
  nonWorking: "bg-blue-300",
};

export function EmployeeStatusList({
  employees,
}: {
  employees: EmployeeTodayStatus[];
}) {
  const shown = employees.slice(0, 8);
  const remaining = employees.length - shown.length;

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-on-surface">
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
          const initials = getInitials(emp.name);
          const avatarColor = getAvatarColor(emp.name);

          return (
            <div
              key={emp.id}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-container-low"
            >
              <span
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${STATUS_DOT[emp.status]}`}
              />
              {emp.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={emp.avatarUrl}
                  alt={emp.name}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${avatarColor} text-xs font-bold text-white`}
                >
                  {initials}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-on-surface">
                  {emp.name}
                </p>
                <p className="text-[11px] text-on-surface-variant">
                  {emp.label
                    ? emp.label
                    : emp.entryTime
                    ? `Entrata ${emp.entryTime}`
                    : "Non registrato"}
                </p>
              </div>
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
