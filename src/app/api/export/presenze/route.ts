import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import {
  calculateDailyStats,
  type DailyRecord,
  type EmployeeScheduleDay,
} from "@/lib/calculator";
import {
  generatePresenzeXlsx,
  presenzeFilename,
  type PresenzeMonthData,
  type PresenzeEmployeeData,
  type PresenzeDayData,
} from "@/lib/excel-presenze";

/**
 * GET /api/export/presenze?month=YYYY-MM
 *
 * Genera il report mensile "foglio presenze" nel formato griglia
 * dipendenti × giorni (vedi PROMPT_CONTRACT_REPORT_PRESENZE_XLSX.md).
 *
 * Auth: checkAuth() — stesso pattern di /api/export.
 *
 * Logica mapping per cella (dipendente + giorno del mese):
 *
 *   weekend/festivo       → gestito dal generator (riga O = "-", F/P vuota)
 *   leave full-day        → O: vuota, F/P: 8
 *   leave half-day        → O: Math.round(hoursWorked), F/P: 4
 *   leave a ore (ROL/visita)→ O: Math.round(hoursWorked), F/P: Math.round(leaveHours)
 *   solo lavoro           → O: Math.round(hoursWorked), F/P: vuota
 *   assenza senza leave   → entrambe vuote
 *
 * Buoni pasto = conteggio giorni nel mese con hoursWorked >= 6
 * (calcolato solo sulle ore effettivamente lavorate, non sui leave).
 */

const MONTH_REGEX = /^(\d{4})-(\d{2})$/;

// Leave types considerati "giornata intera": assenza totale → 8 ore in F/P
const FULL_DAY_LEAVE_TYPES = new Set([
  "VACATION",
  "SICK",
  "BEREAVEMENT",
  "MARRIAGE",
  "LAW_104",
]);

// Leave types "mezza giornata": 4 ore in F/P, il resto lavorato va in O
const HALF_DAY_LEAVE_TYPES = new Set([
  "VACATION_HALF_AM",
  "VACATION_HALF_PM",
]);

// Leave types "a ore" (il campo leave.hours e' il totale):
// ROL, MEDICAL_VISIT
// → F/P = Math.round(hours), O = Math.round(hoursWorked)

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month");

  if (!monthParam || !MONTH_REGEX.test(monthParam)) {
    return NextResponse.json(
      { error: "Parametro 'month' richiesto nel formato YYYY-MM" },
      { status: 400 }
    );
  }

  const [, yearStr, monthStr] = monthParam.match(MONTH_REGEX)!;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (month < 1 || month > 12) {
    return NextResponse.json({ error: "Mese non valido (1-12)" }, { status: 400 });
  }

  const nDays = new Date(year, month, 0).getDate();
  const from = `${yearStr}-${monthStr}-01`;
  const to = `${yearStr}-${monthStr}-${String(nDays).padStart(2, "0")}`;

  // ── 1. Employees (tutti, anche quelli senza record nel mese) ─────
  const employees = await prisma.employee.findMany({
    orderBy: { name: "asc" }, // ordinamento alfabetico
  });

  // ── 2. Records del mese ──────────────────────────────────────────
  const records = await prisma.attendanceRecord.findMany({
    where: { date: { gte: from, lte: to } },
    include: { employee: true },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });

  // ── 3. Schedules (tutti) ─────────────────────────────────────────
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

  // ── 4. Leaves approvati che si sovrappongono al mese ─────────────
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      startDate: { lte: to },
      endDate: { gte: from },
    },
  });

  // Mappa "employeeId|YYYY-MM-DD" → leave (il primo che matcha basta)
  type LeaveInfo = { type: string; hours: number | null };
  const leaveMap = new Map<string, LeaveInfo>();
  for (const l of leaves) {
    const start = l.startDate < from ? from : l.startDate;
    const end = l.endDate > to ? to : l.endDate;
    const cur = new Date(start);
    const endDate = new Date(end);
    while (cur <= endDate) {
      const dateStr = cur.toISOString().split("T")[0];
      const key = `${l.employeeId}|${dateStr}`;
      // Se ci sono leave multipli per lo stesso giorno teniamo il primo
      // (caso raro, non gestiamo merge di mezze giornate diverse qui).
      if (!leaveMap.has(key)) {
        leaveMap.set(key, { type: l.type, hours: l.hours ?? null });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  // ── 5. Group records by employee+date → DailyRecord ──────────────
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

  // Calcola hoursWorked per ogni (employee, date) che abbia record
  const hoursMap = new Map<string, number>(); // "employeeId|YYYY-MM-DD" → hoursWorked
  for (const dr of grouped.values()) {
    const dayOfWeek = getDayOfWeek(dr.date);
    const empSchedule = scheduleMap.get(dr.employeeId)?.get(dayOfWeek) ?? null;
    const stats = calculateDailyStats(dr, empSchedule);
    hoursMap.set(`${dr.employeeId}|${dr.date}`, stats.hoursWorked);
  }

  // ── 6. Build PresenzeEmployeeData per ogni employee ──────────────
  const presenzeEmployees: PresenzeEmployeeData[] = [];

  for (const emp of employees) {
    const days = new Map<number, PresenzeDayData>();
    let buoniPasto = 0;

    for (let d = 1; d <= nDays; d++) {
      const dateStr = `${yearStr}-${monthStr}-${String(d).padStart(2, "0")}`;
      const keyHours = `${emp.id}|${dateStr}`;
      const keyLeave = `${emp.id}|${dateStr}`;

      const hoursWorked = hoursMap.get(keyHours) ?? 0;
      const leave = leaveMap.get(keyLeave);

      // Conteggio buoni pasto (solo ore effettivamente lavorate)
      if (hoursWorked >= 6) buoniPasto++;

      // Se il giorno e' non lavorativo, il generator mette "-" da solo:
      // non serve popolare la Map
      // (isNonWorkingDay viene controllato dentro generatePresenzeXlsx)

      let oreOrdinario: number | null = null;
      let oreFuoriSede: number | null = null;

      if (leave) {
        if (FULL_DAY_LEAVE_TYPES.has(leave.type)) {
          oreOrdinario = null;
          oreFuoriSede = 8;
        } else if (HALF_DAY_LEAVE_TYPES.has(leave.type)) {
          oreOrdinario = hoursWorked > 0 ? Math.round(hoursWorked) : null;
          oreFuoriSede = 4;
        } else {
          // ROL / MEDICAL_VISIT / altri a ore
          const leaveHours = leave.hours ?? 0;
          oreOrdinario = hoursWorked > 0 ? Math.round(hoursWorked) : null;
          oreFuoriSede = leaveHours > 0 ? Math.round(leaveHours) : null;
        }
      } else if (hoursWorked > 0) {
        oreOrdinario = Math.round(hoursWorked);
      }

      // Popola solo se c'e' qualcosa da mostrare. Il generator
      // distingue "giorno non lavorativo" (che non sta nella Map) da
      // "giorno lavorativo senza dati" (che nemmeno sta nella Map).
      // Per i giorni lavorativi con dati effettivi, li aggiungiamo.
      if (oreOrdinario !== null || oreFuoriSede !== null) {
        days.set(d, { oreOrdinario, oreFuoriSede });
      }
    }

    presenzeEmployees.push({
      displayName: (emp.displayName || emp.name).toUpperCase(),
      days,
      buoniPasto,
    });
  }

  // Ordina per cognome (prima parola del displayName)
  presenzeEmployees.sort((a, b) => {
    const lastA = a.displayName.split(" ")[0];
    const lastB = b.displayName.split(" ")[0];
    return lastA.localeCompare(lastB);
  });

  // ── 7. Generate xlsx ─────────────────────────────────────────────
  const data: PresenzeMonthData = { year, month, employees: presenzeEmployees };
  const buf = await generatePresenzeXlsx(data);

  return new NextResponse(buf as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${presenzeFilename(year, month)}"`,
    },
  });
}

function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 7 : day;
}
