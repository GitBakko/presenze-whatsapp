import { CalendarClock } from "lucide-react";
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

export function UpcomingLeavesBox({ leaves, today }: { leaves: LeaveListItem[]; today: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-primary" strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-on-surface">Prossimi 14 giorni</h3>
        </div>
        <StatusBadge kind="info">{leaves.length}</StatusBadge>
      </div>
      {leaves.length === 0 ? (
        <p className="py-4 text-center text-sm text-on-surface-variant">Nessuna assenza pianificata</p>
      ) : (
        <ul className="max-h-80 space-y-3 overflow-y-auto" role="list">
          {leaves.map((l) => (
            <li key={`${l.employeeId}-${l.type}-${l.startDate}`} className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container text-xs font-bold">
                {getInitials(l.employeeName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-on-surface">{l.employeeName}</span>
                  <StatusBadge kind={leaveKind(l.type)}>
                    {(LEAVE_TYPES as Record<string, { label: string }>)[l.type]?.label ?? l.type}
                  </StatusBadge>
                </div>
                <p className="text-xs text-on-surface-variant">{formatLeaveDetail(l, "upcoming", today)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
