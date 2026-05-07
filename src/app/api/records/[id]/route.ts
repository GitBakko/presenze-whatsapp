import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { notificationsBus } from "@/lib/notifications-bus";
import { calculateDailyStats, type DailyRecord, type EmployeeScheduleDay } from "@/lib/calculator";
import { syncAnomalies } from "@/lib/anomaly-sync";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();
  const { type, declaredTime, date } = body as {
    type?: string;
    declaredTime?: string;
    date?: string;
  };

  const VALID_TYPES = ["ENTRY", "EXIT", "PAUSE_START", "PAUSE_END", "OVERTIME_START", "OVERTIME_END"];
  if (type && !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `Tipo non valido. Valori ammessi: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  if (declaredTime && !/^\d{2}:\d{2}$/.test(declaredTime)) {
    return NextResponse.json({ error: "Formato orario non valido (HH:MM)" }, { status: 400 });
  }

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }

  // Load original to know old date and employeeId
  const original = await prisma.attendanceRecord.findUnique({
    where: { id },
    include: { employee: true },
  });
  if (!original) {
    return NextResponse.json({ error: "Timbratura non trovata" }, { status: 404 });
  }

  const newDate = date ?? original.date;
  const newType = type ?? original.type;
  const newTime = declaredTime ?? original.declaredTime;

  // Check unique constraint — block if another record with same (employeeId, date, type, time) exists
  if (newDate !== original.date || newType !== original.type || newTime !== original.declaredTime) {
    const conflict = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: original.employeeId,
        date: newDate,
        type: newType,
        declaredTime: newTime,
        id: { not: id },
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: `Esiste già una timbratura ${newType} del ${newDate} alle ${newTime} per questo dipendente` },
        { status: 409 }
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (type) data.type = type;
  if (declaredTime) data.declaredTime = declaredTime;
  if (date) data.date = date;

  const record = await prisma.attendanceRecord.update({
    where: { id },
    data,
    include: { employee: true },
  });

  try {
    notificationsBus.publish({
      employeeId: record.employeeId,
      employeeName: record.employee.displayName || record.employee.name,
      action: "RECORD_UPDATED",
      time: record.declaredTime,
      date: record.date,
      details: { recordId: record.id, recordType: record.type },
    });
  } catch (err) {
    console.error("[records/PUT] bus publish failed:", err);
  }

  // Ricalcola anomalie per i giorni coinvolti (vecchia data + nuova data se diverse)
  const datesToSync =
    original.date === record.date ? [record.date] : [original.date, record.date];
  try {
    await resyncAnomaliesForDates(
      original.employeeId,
      original.employee.displayName || original.employee.name,
      datesToSync
    );
  } catch (err) {
    console.error("[records/PUT] anomaly sync failed:", err);
  }

  return NextResponse.json(record);
}

/**
 * Recalculates anomalies for the given employee on the given dates.
 * Stale unresolved anomalies are marked as resolved with an automatic note.
 */
async function resyncAnomaliesForDates(
  employeeId: string,
  employeeName: string,
  dates: string[]
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

  // Group records by date
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

  await syncAnomalies(dailyStats, { resolveNote: "Risolta automaticamente da modifica timbratura" });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;

  const existing = await prisma.attendanceRecord.findUnique({
    where: { id },
    include: { employee: true },
  });

  await prisma.attendanceRecord.delete({ where: { id } });

  if (existing) {
    try {
      notificationsBus.publish({
        employeeId: existing.employeeId,
        employeeName: existing.employee.displayName || existing.employee.name,
        action: "RECORD_DELETED",
        time: existing.declaredTime,
        date: existing.date,
        details: { recordId: existing.id, recordType: existing.type },
      });
    } catch (err) {
      console.error("[records/DELETE] bus publish failed:", err);
    }
  }

  return NextResponse.json({ deleted: true });
}
