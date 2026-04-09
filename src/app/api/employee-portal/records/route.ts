import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateEmployeeApiKey } from "@/lib/employee-api-key-auth";
import {
  calculateDailyStats,
  type DailyRecord,
  type EmployeeScheduleDay,
} from "@/lib/calculator";

/**
 * GET /api/employee-portal/records?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Restituisce le timbrature e i dati calcolati (ore lavorate, pause,
 * straordinari, ritardi) di un singolo dipendente, identificato dalla
 * EmployeeApiKey personale passata nell'header Authorization.
 *
 * Auth: Bearer EmployeeApiKey (NON la globale ApiKey, NON la sessione).
 *
 * Filtro date obbligatorio, max 366 giorni per request.
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await validateEmployeeApiKey(request);
  if (!auth.valid) {
    return NextResponse.json(
      { error: "API key non valida o disattivata" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to || !DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
    return NextResponse.json(
      { error: "Parametri 'from' e 'to' obbligatori nel formato YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (from > to) {
    return NextResponse.json(
      { error: "'from' deve essere <= 'to'" },
      { status: 400 }
    );
  }

  // Limite 366 giorni per evitare query enormi
  const diffMs =
    new Date(to).getTime() - new Date(from).getTime();
  if (diffMs > 366 * 24 * 60 * 60 * 1000) {
    return NextResponse.json(
      { error: "Range massimo 366 giorni" },
      { status: 400 }
    );
  }

  const { employeeId } = auth;

  // Employee
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { schedule: true },
  });
  if (!employee) {
    return NextResponse.json(
      { error: "Dipendente non trovato" },
      { status: 404 }
    );
  }

  // Schedule map
  const scheduleMap = new Map<number, EmployeeScheduleDay>();
  for (const s of employee.schedule) {
    scheduleMap.set(s.dayOfWeek, {
      block1Start: s.block1Start,
      block1End: s.block1End,
      block2Start: s.block2Start,
      block2End: s.block2End,
    });
  }

  // Records nel range
  const records = await prisma.attendanceRecord.findMany({
    where: {
      employeeId,
      date: { gte: from, lte: to },
    },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });

  // Raggruppa per data
  const grouped = new Map<string, DailyRecord>();
  for (const r of records) {
    if (!grouped.has(r.date)) {
      grouped.set(r.date, {
        employeeId: r.employeeId,
        employeeName: employee.displayName || employee.name,
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

  // Calcola stats per ogni giorno
  const days = Array.from(grouped.values()).map((dr) => {
    const dayOfWeek = getDayOfWeek(dr.date);
    const empSchedule = scheduleMap.get(dayOfWeek) ?? null;
    const stats = calculateDailyStats(dr, empSchedule);
    return {
      date: stats.date,
      entries: stats.entries,
      exits: stats.exits,
      hoursWorked: stats.hoursWorked,
      pauseMinutes: stats.pauseMinutes,
      pauses: stats.pauses,
      morningDelay: stats.morningDelay,
      afternoonDelay: stats.afternoonDelay,
      overtime: stats.overtime,
      overtimeBlocks: stats.overtimeBlocks,
      hasAnomaly: stats.hasAnomaly,
      anomalies: stats.anomalies,
      records: dr.records.map((r) => ({
        type: r.type,
        declaredTime: r.declaredTime,
        messageTime: r.messageTime,
      })),
    };
  });

  return NextResponse.json({
    employee: {
      name: employee.displayName || employee.name,
      contractType: employee.contractType,
    },
    from,
    to,
    totalDays: days.length,
    days,
  });
}

function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 7 : day;
}
