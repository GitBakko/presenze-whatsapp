import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { calculateDailyStats, type DailyRecord, type EmployeeScheduleDay } from "@/lib/calculator";

/**
 * POST /api/anomalies/cleanup
 * Ricalcola tutte le anomalie su tutti i record presenti e cancella quelle
 * NON RISOLTE che il calculator aggiornato non rileva piu' (falsi positivi
 * storici). Lascia intatte le anomalie risolte.
 *
 * Endpoint amministrativo one-shot, protetto da checkAuth.
 */
export async function POST() {
  const denied = await checkAuth();
  if (denied) return denied;

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

  const records = await prisma.attendanceRecord.findMany({
    include: { employee: true },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });

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

  const stillValid = new Set<string>();
  for (const dr of grouped.values()) {
    const [y, m, d] = dr.date.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const dayOfWeek = dow === 0 ? 7 : dow;
    const empSchedule = scheduleMap.get(dr.employeeId)?.get(dayOfWeek) ?? null;
    const stats = calculateDailyStats(dr, empSchedule);
    for (const a of stats.anomalies) {
      stillValid.add(`${dr.employeeId}|${dr.date}|${a.type}|${a.description}`);
    }
  }

  const dbAnomalies = await prisma.anomaly.findMany({ where: { resolved: false } });
  const toRemove: { id: string; date: string; type: string; description: string }[] = [];
  for (const a of dbAnomalies) {
    const k = `${a.employeeId}|${a.date}|${a.type}|${a.description}`;
    if (!stillValid.has(k)) {
      toRemove.push({ id: a.id, date: a.date, type: a.type, description: a.description });
    }
  }

  if (toRemove.length > 0) {
    await prisma.anomaly.deleteMany({ where: { id: { in: toRemove.map((a) => a.id) } } });
  }

  return NextResponse.json({
    scanned: dbAnomalies.length,
    removed: toRemove.length,
    kept: dbAnomalies.length - toRemove.length,
    removedItems: toRemove,
  });
}
