import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  calculateDailyStats,
  type DailyRecord,
  type EmployeeScheduleDay,
} from "@/lib/calculator";
import { checkAuth } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const refDateParam = searchParams.get("refDate"); // reference date for the day panel
  const today = new Date().toISOString().split("T")[0];

  const rangeFrom = from ?? today;
  const rangeTo = to ?? today;

  // Find available dates (distinct dates with records) and last registered date
  const availableDatesRaw: { date: string }[] = await prisma.$queryRaw`
    SELECT DISTINCT date FROM AttendanceRecord ORDER BY date DESC
  `;
  const availableDates = availableDatesRaw.map((r) => r.date);
  const lastRegisteredDate = availableDates[0] ?? today;
  const refDate = refDateParam ?? lastRegisteredDate;

  // ── Parallel data fetching ──
  const [allEmployees, refDateRecords, rangeRecords, schedules, openAnomalies, totalAnomalies, dismissedAnomalies] =
    await Promise.all([
      prisma.employee.findMany({ select: { id: true, name: true, displayName: true } }),
      prisma.attendanceRecord.findMany({
        where: { date: refDate },
        include: { employee: true },
        orderBy: { declaredTime: "asc" },
      }),
      prisma.attendanceRecord.findMany({
        where: { date: { gte: rangeFrom, lte: rangeTo } },
        include: { employee: true },
        orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
      }),
      prisma.employeeSchedule.findMany(),
      prisma.anomaly.count({ where: { resolved: false } }),
      prisma.anomaly.count(),
      prisma.anomaly.findMany({
        where: { resolved: true },
        select: { employeeId: true, date: true, type: true, description: true },
      }),
    ]);

  const dismissedSet = new Set(
    dismissedAnomalies.map((d) => `${d.employeeId}|${d.date}|${d.type}|${d.description}`)
  );

  // Build schedule map
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

  function getDayOfWeek(dateStr: string): number {
    const [y, m, d] = dateStr.split("-").map(Number);
    const day = new Date(y, m - 1, d).getDay();
    return day === 0 ? 7 : day;
  }

  function groupAndCalc(records: typeof refDateRecords) {
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
    return Array.from(grouped.values()).map((dr) => {
      const dow = getDayOfWeek(dr.date);
      const empSchedule = scheduleMap.get(dr.employeeId)?.get(dow) ?? null;
      const s = calculateDailyStats(dr, empSchedule);
      s.anomalies = s.anomalies.filter(
        (a) => !dismissedSet.has(`${s.employeeId}|${s.date}|${a.type}|${a.description}`)
      );
      s.hasAnomaly = s.anomalies.length > 0;
      return s;
    });
  }

  const todayStats = groupAndCalc(refDateRecords);
  const rangeStats = groupAndCalc(rangeRecords);

  // ── TODAY KPIs ──
  const totalEmployees = allEmployees.length;
  const presentTodaySet = new Set(
    todayStats.filter((d) => d.entries.length > 0).map((d) => d.employeeId)
  );
  const presentToday = presentTodaySet.size;
  const absentToday = totalEmployees - presentToday;

  // Still working = has entry but no exit (or more entries than exits)
  const stillWorking = todayStats.filter(
    (d) => d.entries.length > 0 && d.entries.length > d.exits.length
  ).length;

  // Delays today
  const delaysToday = todayStats.filter(
    (d) => d.morningDelay > 0 || d.afternoonDelay > 0
  ).length;

  const anomaliesToday = todayStats.filter((d) => d.hasAnomaly).length;

  // ── RANGE KPIs ──
  const totalDaysRecorded = rangeStats.length; // total employee-days
  const totalHours = rangeStats.reduce((s, d) => s + d.hoursWorked, 0);
  const avgHours = totalDaysRecorded > 0 ? totalHours / totalDaysRecorded : 0;
  const totalOvertime = rangeStats.reduce((s, d) => s + d.overtime, 0);

  // Delays in range
  const daysWithDelay = rangeStats.filter(
    (d) => d.morningDelay > 0 || d.afternoonDelay > 0
  );
  const totalDelays = daysWithDelay.length;
  const punctualityRate =
    totalDaysRecorded > 0
      ? ((totalDaysRecorded - totalDelays) / totalDaysRecorded) * 100
      : 100;
  const avgDelayMinutes =
    totalDelays > 0
      ? daysWithDelay.reduce(
          (s, d) => s + d.morningDelay + d.afternoonDelay,
          0
        ) / totalDelays
      : 0;

  // Pause stats
  const totalPauseMinutes = rangeStats.reduce((s, d) => s + d.pauseMinutes, 0);
  const daysWithPause = rangeStats.filter((d) => d.pauses.length > 0).length;
  const daysWithoutPause = totalDaysRecorded - daysWithPause;
  const avgPauseMinutes = daysWithPause > 0 ? totalPauseMinutes / daysWithPause : 0;

  // Employee with most overtime
  const overtimeByEmployee = new Map<string, { name: string; hours: number }>();
  for (const d of rangeStats) {
    const prev = overtimeByEmployee.get(d.employeeId);
    if (prev) {
      prev.hours += d.overtime;
    } else {
      overtimeByEmployee.set(d.employeeId, {
        name: d.employeeName,
        hours: d.overtime,
      });
    }
  }
  let topOvertimeEmployee: { name: string; hours: number } | null = null;
  for (const v of overtimeByEmployee.values()) {
    if (v.hours > 0 && (!topOvertimeEmployee || v.hours > topOvertimeEmployee.hours)) {
      topOvertimeEmployee = v;
    }
  }

  // Anomaly resolution rate
  const resolvedAnomalies = totalAnomalies - openAnomalies;
  const anomalyResolutionRate =
    totalAnomalies > 0 ? (resolvedAnomalies / totalAnomalies) * 100 : 100;

  // ── Chart data (averages per employee) ──
  const byEmployee = new Map<string, { ore: number; pausa: number; straordinarioMin: number; days: number }>();
  for (const d of rangeStats) {
    const existing = byEmployee.get(d.employeeName) || { ore: 0, pausa: 0, straordinarioMin: 0, days: 0 };
    existing.ore += d.hoursWorked;
    existing.pausa += d.pauseMinutes;
    existing.straordinarioMin += Math.round(d.overtime * 60);
    existing.days += 1;
    byEmployee.set(d.employeeName, existing);
  }
  const chartData = Array.from(byEmployee.entries()).map(([name, v]) => ({
    name,
    oreMedia: v.days > 0 ? Math.round((v.ore / v.days) * 10) / 10 : 0,
    pausaMedia: v.days > 0 ? Math.round((v.pausa / v.days) * 10) / 10 : 0,
    straordinarioMedia: v.days > 0 ? Math.round((v.straordinarioMin / v.days) * 10) / 10 : 0,
  }));

  return NextResponse.json({
    // Today
    today: {
      totalEmployees,
      present: presentToday,
      absent: absentToday,
      stillWorking,
      delays: delaysToday,
      anomalies: anomaliesToday,
    },
    // Period
    period: {
      totalHours: Math.round(totalHours * 100) / 100,
      avgHours: Math.round(avgHours * 100) / 100,
      totalOvertime: Math.round(totalOvertime * 100) / 100,
      topOvertimeEmployee,
      totalDelays,
      punctualityRate: Math.round(punctualityRate * 10) / 10,
      avgDelayMinutes: Math.round(avgDelayMinutes),
      daysWithoutPause,
      avgPauseMinutes: Math.round(avgPauseMinutes),
    },
    // Global anomalies
    anomalies: {
      open: openAnomalies,
      total: totalAnomalies,
      resolutionRate: Math.round(anomalyResolutionRate * 10) / 10,
    },
    // Chart
    chartData,
    // Reference date
    refDate,
    availableDates,
    // Day stats for reference date
    todayStats: todayStats.map((d) => ({
      employeeId: d.employeeId,
      employeeName: d.employeeName,
      date: d.date,
      entries: d.entries,
      exits: d.exits,
      hoursWorked: d.hoursWorked,
      hoursWorkedMsg: d.hoursWorkedMsg,
      pauseMinutes: d.pauseMinutes,
      morningDelay: d.morningDelay,
      afternoonDelay: d.afternoonDelay,
      overtime: d.overtime,
      hasAnomaly: d.hasAnomaly,
      anomalies: d.anomalies,
    })),
  });
}
