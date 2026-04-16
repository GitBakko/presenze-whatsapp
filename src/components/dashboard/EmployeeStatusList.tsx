"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { EmployeeTodayStatus, EmployeeStatus } from "@/types/dashboard";
import { getInitials } from "@/lib/avatar-utils";

const STATUS_DOT: Record<EmployeeStatus, { dot: string; label: string }> = {
  present: { dot: "bg-green-500", label: "Presente" },
  late: { dot: "bg-amber-500", label: "In ritardo" },
  absent: { dot: "bg-red-500", label: "Assente" },
  sick: { dot: "bg-red-400", label: "Malattia" },
  vacation: { dot: "bg-outline-variant", label: "Ferie" },
  nonWorking: { dot: "bg-blue-300", label: "Non lavorativo" },
};

export function EmployeeStatusList({
  employees,
}: {
  employees: EmployeeTodayStatus[];
}) {
  const shown = employees.slice(0, 12);
  const remaining = employees.length - shown.length;

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5">
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
      <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((emp) => {
          const initials = getInitials(emp.name);
          const statusInfo = STATUS_DOT[emp.status];

          return (
            <div
              key={emp.id}
              className="rounded-xl border border-outline-variant/20 bg-surface-container-low/50 p-3"
            >
              <div className="flex items-center gap-2">
                {emp.avatarUrl ? (
                  <Image
                    src={emp.avatarUrl}
                    alt={emp.name}
                    width={28}
                    height={28}
                    className="h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container text-[10px] font-bold text-on-primary-container">
                    {initials}
                  </div>
                )}
                <span className="truncate text-sm font-medium text-on-surface">{emp.name}</span>
                <span
                  className={`ml-auto h-2 w-2 shrink-0 rounded-full ${statusInfo.dot}`}
                  aria-label={statusInfo.label}
                />
                <span className="shrink-0 text-[10px] text-on-surface-variant">{statusInfo.label}</span>
              </div>
              <p className="mt-1.5 text-xs text-on-surface-variant">
                {emp.label
                  ? emp.label
                  : emp.entryTime
                  ? `Entrata ${emp.entryTime}`
                  : "Non timbrato"}
              </p>
              {emp.delayMinutes > 15 && (
                <div className="mt-1 flex items-center gap-1 text-xs font-medium text-warning">
                  <AlertTriangle className="h-3 w-3" />
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
