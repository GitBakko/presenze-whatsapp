import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseWhatsAppExport } from "@/lib/parser";
import { checkAuth } from "@/lib/auth-guard";
import { calculateDailyStats, type DailyRecord, type EmployeeScheduleDay } from "@/lib/calculator";
import { syncAnomalies } from "@/lib/anomaly-sync";

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "File richiesto" }, { status: 400 });
  }

  // Validate file size (max 50 MB)
  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File troppo grande (max 50 MB)" }, { status: 400 });
  }

  // Validate file type
  const allowedTypes = ["text/plain", "text/csv", "application/octet-stream"];
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!allowedTypes.includes(file.type) && ext !== "txt" && ext !== "csv") {
    return NextResponse.json({ error: "Tipo file non supportato. Usa .txt o .csv" }, { status: 400 });
  }

  const text = await file.text();

  // Load excluded names from DB
  const excludedNamesDb = await prisma.excludedName.findMany();
  const excludedNames = excludedNamesDb.map((n) => n.name);

  const { records, errors } = parseWhatsAppExport(text, excludedNames);

  let imported = 0;
  let skipped = 0;
  const importErrors: string[] = [...errors];

  for (const record of records) {
    // Find or create employee
    let employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { name: record.employeeName },
          { aliases: { contains: JSON.stringify(record.employeeName) } },
        ],
      },
    });

    if (!employee) {
      employee = await prisma.employee.create({
        data: { name: record.employeeName },
      });
    }

    // Try to insert (skip duplicates via unique constraint)
    try {
      await prisma.attendanceRecord.create({
        data: {
          employeeId: employee.id,
          date: record.date,
          type: record.type,
          declaredTime: record.declaredTime,
          messageTime: record.messageTime,
          rawMessage: record.rawMessage,
          source: "PARSED",
        },
      });
      imported++;
    } catch (e: unknown) {
      const error = e as { code?: string };
      if (error.code === "P2002") {
        skipped++;
      } else {
        importErrors.push(
          `Errore per ${record.employeeName} ${record.date}: ${String(e)}`
        );
      }
    }
  }

  // Log the import
  await prisma.importLog.create({
    data: {
      filename: file.name,
      recordsImported: imported,
      recordsSkipped: skipped,
      errors: JSON.stringify(importErrors),
    },
  });

  // --- Detect and persist anomalies for imported dates ---
  const importedDates = [...new Set(records.map((r) => r.date))];
  if (importedDates.length > 0) {
    const minDate = importedDates.sort()[0];
    const maxDate = importedDates.sort()[importedDates.length - 1];

    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: { date: { gte: minDate, lte: maxDate } },
      include: { employee: true },
      orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
    });

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

    const grouped = new Map<string, DailyRecord>();
    for (const r of attendanceRecords) {
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

    const dailyStats = Array.from(grouped.values()).map((dr) => {
      const [y, m, d] = dr.date.split("-").map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      const dayOfWeek = dow === 0 ? 7 : dow;
      const empSchedule = scheduleMap.get(dr.employeeId)?.get(dayOfWeek) ?? null;
      return calculateDailyStats(dr, empSchedule);
    });

    await syncAnomalies(dailyStats);
  }

  return NextResponse.json({
    imported,
    skipped,
    total: records.length,
    errors: importErrors,
  });
}
