import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { calculateDailyStats, type DailyRecord, type EmployeeScheduleDay } from "@/lib/calculator";
import { WORK_SCHEDULE } from "@/lib/constants";

function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 7 : day;
}

// Anomaly types that are computed at runtime (not stored by import/sync)
const COMPUTED_TYPES = new Set(["TIME_BLOCK_MISMATCH", "TIME_OVERLAP"]);

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const resolved = searchParams.get("resolved");

  const where: Record<string, unknown> = {};
  if (from && to) {
    where.date = { gte: from, lte: to };
  }
  if (resolved !== null) {
    where.resolved = resolved === "true";
  }

  // 1. Load DB anomalies
  const dbAnomalies = await prisma.anomaly.findMany({
    where,
    include: { employee: true, resolvedBy: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  const result = dbAnomalies.map((a) => ({
    id: a.id,
    employee: a.employee.displayName || a.employee.name,
    employeeId: a.employeeId,
    date: a.date,
    type: a.type,
    description: a.description,
    resolved: a.resolved,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    resolvedBy: a.resolvedBy?.name ?? null,
    resolution: a.resolution,
    computed: COMPUTED_TYPES.has(a.type),
  }));

  // 2. Compute live anomalies from attendance records (only computed types)
  //    Skip if user is filtering to resolved-only (computed anomalies are never "resolved" in DB until dismissed)
  if (resolved !== "true") {
    const dateWhere: Record<string, unknown> = {};
    if (from && to) dateWhere.date = { gte: from, lte: to };

    const [records, schedules] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: dateWhere,
        include: { employee: true },
        orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
      }),
      prisma.employeeSchedule.findMany(),
    ]);

    const scheduleMap = new Map<string, Map<number, EmployeeScheduleDay>>();
    for (const s of schedules) {
      if (!scheduleMap.has(s.employeeId)) scheduleMap.set(s.employeeId, new Map());
      scheduleMap.get(s.employeeId)!.set(s.dayOfWeek, {
        block1Start: s.block1Start,
        block1End: s.block1End,
        block2Start: s.block2Start,
        block2End: s.block2End,
      });
    }

    const grouped = new Map<string, DailyRecord>();
    for (const r of records) {
      const key = `${r.employeeId}-${r.date}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          employeeId: r.employeeId,
          employeeName: r.employee.displayName || r.employee.name,
          date: r.date,
          records: [],
        });
      }
      grouped.get(key)!.records.push({
        type: r.type as DailyRecord["records"][0]["type"],
        declaredTime: r.declaredTime,
        messageTime: r.messageTime,
      });
    }

    // Build a set of already-present anomalies (both DB-stored and dismissed)
    const existingSet = new Set(
      result.map((a) => `${a.employeeId}|${a.date}|${a.type}|${a.description}`)
    );

    for (const dr of grouped.values()) {
      const dow = getDayOfWeek(dr.date);
      const empSchedule = scheduleMap.get(dr.employeeId)?.get(dow) ?? null;
      const stats = calculateDailyStats(dr, empSchedule);

      for (const a of stats.anomalies) {
        if (!COMPUTED_TYPES.has(a.type)) continue;
        const key = `${stats.employeeId}|${stats.date}|${a.type}|${a.description}`;
        if (existingSet.has(key)) continue;
        existingSet.add(key);

        result.push({
          id: `computed-${stats.employeeId}-${stats.date}-${a.type}-${result.length}`,
          employee: stats.employeeName,
          employeeId: stats.employeeId,
          date: stats.date,
          type: a.type,
          description: a.description,
          resolved: false,
          resolvedAt: null,
          resolvedBy: null,
          resolution: null,
          computed: true,
        });
      }
    }

    // Re-sort by date desc
    result.sort((a, b) => b.date.localeCompare(a.date));
  }

  return NextResponse.json(result);
}
