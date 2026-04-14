import { getDayOfWeek } from "@/lib/date-utils";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateDailyStats, aggregateMonthlyStats, type DailyRecord, type EmployeeScheduleDay } from "@/lib/calculator";
import { checkAuth } from "@/lib/auth-guard";
import { syncAnomalies } from "@/lib/anomaly-sync";

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let whereDate: object = {};
  if (from && to) {
    whereDate = { date: { gte: from, lte: to } };
  } else {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    whereDate = { date: { gte: `${y}-${m}-01`, lte: `${y}-${m}-31` } };
  }

  const records = await prisma.attendanceRecord.findMany({
    where: whereDate,
    include: { employee: true },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });

  // Load schedules
  const schedules = await prisma.employeeSchedule.findMany();
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

  // Group by employee+date
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

  const [dismissed] = await Promise.all([
    prisma.anomaly.findMany({
      where: { resolved: true },
      select: { employeeId: true, date: true, type: true, description: true },
    }),
  ]);
  const dismissedSet = new Set(
    dismissed.map((d) => `${d.employeeId}|${d.date}|${d.type}|${d.description}`)
  );

  const dailyStats = Array.from(grouped.values()).map((dr) => {
    const dayOfWeek = getDayOfWeek(dr.date);
    const empSchedule = scheduleMap.get(dr.employeeId)?.get(dayOfWeek) ?? null;
    const s = calculateDailyStats(dr, empSchedule);
    s.anomalies = s.anomalies.filter(
      (a) => !dismissedSet.has(`${s.employeeId}|${s.date}|${a.type}|${a.description}`)
    );
    s.hasAnomaly = s.anomalies.length > 0;
    return s;
  });

  // Persist anomalies in background (fire-and-forget)
  syncAnomalies(dailyStats).catch(() => {});

  // Aggregate per employee
  const byEmployee = new Map<string, typeof dailyStats>();
  for (const ds of dailyStats) {
    if (!byEmployee.has(ds.employeeId)) byEmployee.set(ds.employeeId, []);
    byEmployee.get(ds.employeeId)!.push(ds);
  }

  const summary = Array.from(byEmployee.entries()).map(([empId, stats]) => ({
    employeeId: empId,
    employeeName: stats[0].employeeName,
    ...aggregateMonthlyStats(stats),
    daily: stats,
  }));

  return NextResponse.json(summary);
}

