// src/lib/attendance/recompute.ts
import { prisma } from "@/lib/db";
import {
  calculateDailyStats,
  type DailyRecord,
  type EmployeeScheduleDay,
} from "@/lib/calculator";
import { syncAnomalies } from "@/lib/anomaly-sync";

export const WATCHED_RECORD_FIELDS = ["type", "declaredTime", "date"] as const;
export type WatchedRecordField = (typeof WATCHED_RECORD_FIELDS)[number];

export interface RecordSnapshot {
  type?: string | null;
  declaredTime?: string | null;
  date?: string | null;
  [key: string]: unknown;
}

export interface RecordDiff {
  changedFields: WatchedRecordField[];
  changes: Partial<Record<WatchedRecordField, { old: unknown; new: unknown }>>;
}

function eq(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  return a === b;
}

/** Pure diff over the editable record fields. Mirrors leaves/audit computeDiff. */
export function computeRecordDiff(prev: RecordSnapshot, next: RecordSnapshot): RecordDiff {
  const changedFields: WatchedRecordField[] = [];
  const changes: RecordDiff["changes"] = {};
  for (const f of WATCHED_RECORD_FIELDS) {
    if (!eq(prev[f], next[f])) {
      changedFields.push(f);
      changes[f] = { old: prev[f] ?? null, new: next[f] ?? null };
    }
  }
  return { changedFields, changes };
}

/**
 * Recalculates anomalies for the given employee on the given dates and resolves
 * stale unresolved anomalies. Extracted from records/[id]/route.ts so POST,
 * PUT, DELETE and the batch day endpoint all share one recompute path.
 */
export async function recomputeAnomaliesForDates(
  employeeId: string,
  employeeName: string,
  dates: string[],
): Promise<void> {
  const sorted = [...dates].sort();
  const minDate = sorted[0];
  const maxDate = sorted[sorted.length - 1];

  const attendanceRecords = await prisma.attendanceRecord.findMany({
    where: { employeeId, date: { gte: minDate, lte: maxDate } },
    include: { employee: true },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });

  const schedules = await prisma.employeeSchedule.findMany({ where: { employeeId } });
  const empScheduleMap = new Map<number, EmployeeScheduleDay>();
  for (const s of schedules) {
    empScheduleMap.set(s.dayOfWeek, {
      block1Start: s.block1Start,
      block1End: s.block1End,
      block2Start: s.block2Start,
      block2End: s.block2End,
    });
  }

  const grouped = new Map<string, DailyRecord>();
  for (const r of attendanceRecords) {
    if (!grouped.has(r.date)) {
      grouped.set(r.date, {
        employeeId: r.employeeId,
        employeeName: r.employee.displayName || r.employee.name,
        date: r.date,
        records: [],
      });
    }
    grouped.get(r.date)!.records.push({
      type: r.type as DailyRecord["records"][0]["type"],
      declaredTime: r.declaredTime,
      messageTime: r.messageTime,
    });
  }

  // Ensure every requested date is represented (even if it now has 0 records)
  for (const date of dates) {
    if (!grouped.has(date)) {
      grouped.set(date, { employeeId, employeeName, date, records: [] });
    }
  }

  const dailyStats = Array.from(grouped.values()).map((dr) => {
    const [y, m, d] = dr.date.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const dayOfWeek = dow === 0 ? 7 : dow;
    const schedule = empScheduleMap.get(dayOfWeek) ?? null;
    return calculateDailyStats(dr, schedule);
  });

  await syncAnomalies(dailyStats, {
    resolveNote: "Risolta automaticamente da modifica timbratura",
  });
}
