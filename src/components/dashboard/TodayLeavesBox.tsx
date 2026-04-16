import { CalendarCheck } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { getInitials } from "@/lib/avatar-utils";
import { formatLeaveDetail } from "@/lib/leave-format";
import { LEAVE_TYPES } from "@/lib/leaves";
import type { LeaveListItem } from "@/types/dashboard";

function leaveKind(type: string): "info" | "warning" | "neutral" {
  if (["VACATION", "VACATION_HALF_AM", "VACATION_HALF_PM"].includes(type)) return "info";
  if (type === "SICK") return "warning";
  return "neutral";
}

export function TodayLeavesBox({ leaves, today }: { leaves: LeaveListItem[]; today: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-primary" strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-on-surface">Ferie & permessi oggi</h3>
        </div>
        <StatusBadge kind="info">{leaves.length}</StatusBadge>
      </div>
      {leaves.length === 0 ? (
        <p className="py-4 text-center text-sm text-on-surface-variant">Nessuna assenza oggi</p>
      ) : (
        <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3" role="list">
          {leaves.map((l) => (
            <div key={`${l.employeeId}-${l.type}-${l.startDate}`} role="listitem" className="rounded-xl border border-outline-variant/20 bg-surface-container-low/50 p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container text-[10px] font-bold">
                  {getInitials(l.employeeName)}
                </div>
                <span className="truncate text-sm font-semibold text-on-surface">{l.employeeName}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <StatusBadge kind={leaveKind(l.type)}>
                  {(LEAVE_TYPES as Record<string, { label: string }>)[l.type]?.label ?? l.type}
                </StatusBadge>
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">
                {formatLeaveDetail(l, "today", today)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
