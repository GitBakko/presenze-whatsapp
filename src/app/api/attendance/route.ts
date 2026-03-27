import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateDailyStats, type DailyRecord, type EmployeeScheduleDay } from "@/lib/calculator";
import { checkAuth } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const employeeId = searchParams.get("employeeId");

  let whereDate: object;

  if (date) {
    whereDate = { date };
  } else if (from && to) {
    whereDate = { date: { gte: from, lte: to } };
  } else {
    const today = new Date().toISOString().split("T")[0];
    whereDate = { date: today };
  }

  const where = employeeId ? { ...whereDate, employeeId } : whereDate;

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: { employee: true },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });

  // Load employee schedules
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

  // Calculate stats for each
  const stats = Array.from(grouped.values()).map((dr) => {
    const dayOfWeek = getDayOfWeek(dr.date);
    const empSchedule = scheduleMap.get(dr.employeeId)?.get(dayOfWeek) ?? null;
    return calculateDailyStats(dr, empSchedule);
  });

  // Load dismissed anomalies and filter them out
  const employeeIds = [...new Set(stats.map((s) => s.employeeId))];
  const dates = [...new Set(stats.map((s) => s.date))];
  const dismissed = await prisma.anomaly.findMany({
    where: {
      employeeId: { in: employeeIds },
      date: { in: dates },
      resolved: true,
    },
    select: { employeeId: true, date: true, type: true, description: true },
  });
  const dismissedSet = new Set(
    dismissed.map((d) => `${d.employeeId}|${d.date}|${d.type}|${d.description}`)
  );

  for (const s of stats) {
    s.anomalies = s.anomalies.filter(
      (a) => !dismissedSet.has(`${s.employeeId}|${s.date}|${a.type}|${a.description}`)
    );
    s.hasAnomaly = s.anomalies.length > 0;
  }

  return NextResponse.json(stats);
}

function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  // Convert: 0=Sun → 7, 1=Mon → 1, ..., 6=Sat → 6
  return day === 0 ? 7 : day;
}
