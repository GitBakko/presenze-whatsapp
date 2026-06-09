/**
 * Generatore del report presenze mensile "foglio presenze" nel formato
 * griglia dipendenti × giorni (stile `gennaio_2026.xlsx`).
 *
 * Ogni dipendente occupa due righe consecutive:
 *   - riga "O"   → ore in sede (ordinario)
 *   - riga "F/P" → ore fuori sede / permesso / smart working
 *
 * La riga F/P ha bordo inferiore medium come separatore visivo tra
 * dipendenti. Tutto il resto dei bordi e' thin.
 *
 * Libreria: ExcelJS (la vecchia dip `xlsx` community non supporta
 * formattazione avanzata: bordi, font per cella, merge con stili).
 */

import ExcelJS from "exceljs";
import { isNonWorkingDay } from "./holidays-it";
import { prisma } from "./db";
import { getDayOfWeek } from "./date-utils";
import { activeOnWhere, isActiveOn } from "@/lib/employees/active";
import {
  calculateDailyStats,
  type DailyRecord,
  type DailyStats,
  type EmployeeScheduleDay,
} from "./calculator";
import { classifyDay, type DayClassification } from "./presenze/classify";

// ── Dati di input ────────────────────────────────────────────────────

export interface PresenzeDayData {
  oreOrdinario: number | null;
  oreFuoriSede: number | null;
}

export interface PresenzeEmployeeData {
  employeeId: string; // stable Employee.id (for the review day-editor; xlsx ignores it)
  displayName: string; // "COGNOME NOME" (gia' uppercase)
  contractType: string; // "FULL_TIME" | "PART_TIME"
  days: Map<number, PresenzeDayData>; // giorno 1-31 → dati
  straordinari: number; // ore straordinari del mese, arrotondate ai 15 min
  scheduledHoursPerDay: Map<number, number>; // giorno 1-31 → ore pianificate dallo schedule
  /** Canonical classification per day-of-month (1-31). Drives cell color + review UI. */
  classifications: Map<number, DayClassification>;
}

export interface PresenzeMonthData {
  year: number;
  month: number; // 1-12
  employees: PresenzeEmployeeData[];
}

// ── Costanti di formattazione ────────────────────────────────────────

const MESI_IT = [
  "", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

const FONT_BASE: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 9,
  bold: true,
  color: { theme: 1 },
};

const FONT_BUONI_HEADER: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: false,
  color: { theme: 1 },
};

const THIN: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FF000000" },
};

const MEDIUM: Partial<ExcelJS.Border> = {
  style: "medium",
  color: { argb: "FF000000" },
};

const BORDERS_ALL_THIN: Partial<ExcelJS.Borders> = {
  top: THIN,
  bottom: THIN,
  left: THIN,
  right: THIN,
};

/** Righe F/P: bordo inferiore medium (separatore dipendenti). */
const BORDERS_FP_CELL: Partial<ExcelJS.Borders> = {
  top: THIN,
  bottom: MEDIUM,
  left: THIN,
  right: THIN,
};

const ALIGN_CENTER_WRAP: Partial<ExcelJS.Alignment> = {
  horizontal: "center",
  vertical: "middle",
  wrapText: true,
};

// ── Helper ───────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number {
  // month e' 1-12; new Date(y, m, 0) restituisce l'ultimo giorno del mese m-1
  return new Date(year, month, 0).getDate();
}

// ── Costanti ore contrattuali ────────────────────────────────────────

const CONTRACT_HOURS: Record<string, number> = {
  FULL_TIME: 8,
  PART_TIME: 4,
};

/** Arrotonda al mezzo più vicino (es. 6.75 → 7.0, 6.25 → 6.5). */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Arrotonda al quarto d'ora più vicino (es. 0.83h → 0.75h, 0.42h → 0.5h). */
function roundQuarter(n: number): number {
  return Math.round(n * 4) / 4;
}

/** Calcola le ore pianificate per un giorno dato lo schedule (block1 + block2). */
function scheduledHoursForDay(schedule: EmployeeScheduleDay | null | undefined): number {
  if (!schedule) return 0;
  if (!schedule.block1Start || !schedule.block1End) return 0;
  const toMin = (t: string): number => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  let minutes = toMin(schedule.block1End) - toMin(schedule.block1Start);
  if (schedule.block2Start && schedule.block2End) {
    minutes += toMin(schedule.block2End) - toMin(schedule.block2Start);
  }
  return minutes / 60;
}

// ── Generatore principale ────────────────────────────────────────────

export async function generatePresenzeXlsx(
  data: PresenzeMonthData
): Promise<Buffer> {
  const { year, month, employees } = data;
  const nDays = daysInMonth(year, month);

  const wb = new ExcelJS.Workbook();
  wb.creator = "HR Presenze";
  wb.created = new Date();

  const ws = wb.addWorksheet("Foglio1");

  // Layout colonne:
  //   colonna 1 = A  → Cognome e nome
  //   colonna 2 = B  → "O" / "F/P"
  //   colonne 3..(2+nDays) = giorni 1..nDays
  //   colonna 3+nDays = "buoni pasto"
  const FIRST_DAY_COL = 3;
  const LAST_DAY_COL = 2 + nDays;
  const BUONI_COL = 3 + nDays;

  // Larghezze colonne
  ws.getColumn(1).width = 19.71;
  ws.getColumn(2).width = 8.29;
  for (let c = FIRST_DAY_COL; c <= LAST_DAY_COL; c++) {
    ws.getColumn(c).width = 2.71;
  }
  ws.getColumn(BUONI_COL).width = 10.86;

  // ── RIGA 1 — Titolo mese ─────────────────────────────────────────
  // A1, B1 vuote ma formattate come da contratto
  const row1 = ws.getRow(1);
  row1.height = 18;

  const cellA1 = row1.getCell(1);
  cellA1.value = null;
  cellA1.font = FONT_BASE;
  cellA1.alignment = ALIGN_CENTER_WRAP;
  cellA1.border = BORDERS_ALL_THIN;
  cellA1.numFmt = "@";

  const cellB1 = row1.getCell(2);
  cellB1.value = null;
  cellB1.font = FONT_BASE;
  cellB1.alignment = ALIGN_CENTER_WRAP;
  cellB1.border = BORDERS_ALL_THIN;
  cellB1.numFmt = "@";

  // Merge C1:<last_day_col>1 con il titolo mese
  const title = `${MESI_IT[month]} ${year}`;
  const cellC1 = row1.getCell(FIRST_DAY_COL);
  cellC1.value = title;
  cellC1.font = FONT_BASE;
  cellC1.alignment = ALIGN_CENTER_WRAP;
  cellC1.border = BORDERS_ALL_THIN;
  cellC1.numFmt = "@";

  ws.mergeCells(1, FIRST_DAY_COL, 1, LAST_DAY_COL);
  // Dopo il merge riapplichiamo i bordi sulla master + su ogni cella
  // dell'intervallo (ExcelJS applica i bordi solo sulla master)
  for (let c = FIRST_DAY_COL; c <= LAST_DAY_COL; c++) {
    const cell = row1.getCell(c);
    cell.border = BORDERS_ALL_THIN;
  }

  // La colonna "buoni pasto" a riga 1 resta vuota senza bordi
  // (come da contratto: solo le colonne del mese hanno bordo)

  // ── RIGA 2 — Header giorni ───────────────────────────────────────
  const row2 = ws.getRow(2);
  row2.height = 18;

  // A2 "COGNOME E NOME" (bordo left/top/bottom thin, right NO)
  const a2 = row2.getCell(1);
  a2.value = "COGNOME E NOME";
  a2.font = FONT_BASE;
  a2.alignment = ALIGN_CENTER_WRAP;
  a2.border = { left: THIN, top: THIN, bottom: THIN };

  // B2 vuota (bordo right/top/bottom thin, left NO)
  const b2 = row2.getCell(2);
  b2.value = null;
  b2.font = FONT_BASE;
  b2.alignment = ALIGN_CENTER_WRAP;
  b2.border = { right: THIN, top: THIN, bottom: THIN };

  // Giorni 1..N
  for (let d = 1; d <= nDays; d++) {
    const cell = row2.getCell(FIRST_DAY_COL + (d - 1));
    cell.value = d;
    cell.font = FONT_BASE;
    cell.alignment = ALIGN_CENTER_WRAP;
    cell.border = BORDERS_ALL_THIN;
  }

  // "straordinari" header: Calibri 11 normal, nessun bordo
  const buoniHeader = row2.getCell(BUONI_COL);
  buoniHeader.value = "straordinari";
  buoniHeader.font = FONT_BUONI_HEADER;
  buoniHeader.alignment = ALIGN_CENTER_WRAP;
  // nessun bordo

  // ── RIGHE DATI — per ogni dipendente ──────────────────────────────
  // Ogni dipendente occupa 2 righe: r_o (ordinario) e r_fp (fuori sede)
  let rowIndex = 3;

  for (const emp of employees) {
    const rO = ws.getRow(rowIndex);
    const rFP = ws.getRow(rowIndex + 1);
    rO.height = 18;
    rFP.height = 18;

    // Col A: nome dipendente (solo nella riga O; riga F/P vuota)
    const aO = rO.getCell(1);
    aO.value = emp.displayName;
    aO.font = FONT_BASE;
    aO.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    aO.border = { left: THIN };

    const aFP = rFP.getCell(1);
    aFP.value = null;
    aFP.font = FONT_BASE;
    aFP.alignment = ALIGN_CENTER_WRAP;
    aFP.border = { left: THIN, bottom: MEDIUM };

    // Col B: "O" / "F/P"
    const bO = rO.getCell(2);
    bO.value = "O";
    bO.font = FONT_BASE;
    bO.alignment = ALIGN_CENTER_WRAP;
    // Nessun bordo come da contratto — solo cellule giorno hanno bordi

    const bFP = rFP.getCell(2);
    bFP.value = "F/P";
    bFP.font = FONT_BASE;
    bFP.alignment = ALIGN_CENTER_WRAP;
    bFP.border = { right: THIN, bottom: MEDIUM };

    // Celle giorni
    for (let d = 1; d <= nDays; d++) {
      const colIdx = FIRST_DAY_COL + (d - 1);
      const cellO = rO.getCell(colIdx);
      const cellFP = rFP.getCell(colIdx);

      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const nonWorking = isNonWorkingDay(dateStr);

      // Formattazione comune
      cellO.font = FONT_BASE;
      cellO.alignment = ALIGN_CENTER_WRAP;
      cellO.border = BORDERS_ALL_THIN;

      cellFP.font = FONT_BASE;
      cellFP.alignment = ALIGN_CENTER_WRAP;
      cellFP.border = BORDERS_FP_CELL;

      if (nonWorking) {
        // Weekend / festivo: "-" in O, vuota in F/P
        cellO.value = "-";
        cellFP.value = null;
      } else {
        const dayData = emp.days.get(d);
        if (dayData) {
          cellO.value = dayData.oreOrdinario ?? null;
          cellFP.value = dayData.oreFuoriSede ?? null;
        } else {
          cellO.value = null;
          cellFP.value = null;
        }
        // Colore cella: deriva da DayClassification (single source of truth,
        // stessa logica del report e della pagina di revisione).
        const cls = emp.classifications.get(d);
        if (cls?.isRed) {
          const redFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
          cellO.fill = redFill;
          cellFP.fill = redFill;
        } else if (cls?.isYellow) {
          const yellowFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
          cellO.fill = yellowFill;
          cellFP.fill = yellowFill;
        }
      }
    }

    // Col "straordinari"
    const buoniO = rO.getCell(BUONI_COL);
    buoniO.value = emp.straordinari > 0 ? emp.straordinari : null;
    buoniO.font = FONT_BASE;
    buoniO.alignment = ALIGN_CENTER_WRAP;
    buoniO.border = BORDERS_ALL_THIN;

    const buoniFP = rFP.getCell(BUONI_COL);
    buoniFP.value = null;
    // Nessuna formattazione bordi sulla riga F/P del buoni pasto
    // (come da contratto: colonna buoni pasto senza bordi su header
    // e su riga F/P)

    rowIndex += 2;
  }

  // ── Generazione buffer ───────────────────────────────────────────
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Utility: espone il nome file canonico ────────────────────────────

export function presenzeFilename(year: number, month: number): string {
  return `presenze_${MESI_IT[month]}_${year}.xlsx`;
}

// ── Leave-type sets (condivisi con buildPresenzeMonthData) ────────────

/** Leave types considerati "giornata intera": assenza totale → 8 ore in F/P */
export const FULL_DAY_LEAVE_TYPES = new Set([
  "VACATION",
  "SICK",
  "BEREAVEMENT",
  "MARRIAGE",
  "LAW_104",
]);

/** Leave types "mezza giornata": 4 ore in F/P, il resto lavorato va in O */
export const HALF_DAY_LEAVE_TYPES = new Set([
  "VACATION_HALF_AM",
  "VACATION_HALF_PM",
]);

/**
 * Build the per-day DayClassification map for a finished PresenzeEmployeeData.
 * Pure given (emp, year, month, isActiveOnDay, statsForDay). `effectiveHours`
 * is derived from the same O + F/P values the xlsx prints (totale), so colors
 * stay byte-identical to the legacy inline rule.
 *
 * @param isActiveOnDay (dateStr) => boolean — Feature 2 isActiveOn closure.
 * @param statsForDay   (d) => DailyStats | null — real stats (for anomalies),
 *                      optional; defaults to null (no anomalies, hours from O+F/P).
 */
export function classifyEmployeeDays(
  emp: PresenzeEmployeeData,
  year: number,
  month: number,
  isActiveOnDay: (dateStr: string) => boolean,
  statsForDay?: (d: number) => DailyStats | null,
): Map<number, DayClassification> {
  const monthStr = String(month).padStart(2, "0");
  const nDays = new Date(year, month, 0).getDate();
  const out = new Map<number, DayClassification>();
  for (let d = 1; d <= nDays; d++) {
    const dateStr = `${year}-${monthStr}-${String(d).padStart(2, "0")}`;
    const scheduledHours = emp.scheduledHoursPerDay.get(d) ?? 0;
    const dayData = emp.days.get(d);
    const oreOrdinario = dayData?.oreOrdinario ?? 0;
    const oreFuoriSede = dayData?.oreFuoriSede ?? 0;
    // F/P column carries leave (and fuori-sede) hours; treat it as leaveHours so
    // effectiveHours = totale, matching the printed cell value exactly.
    const leaveHours = oreFuoriSede;
    // BYTE-IDENTITY: the COLOR decision MUST use the PRINTED hours
    // (oreOrdinario + oreFuoriSede = totale), NOT the raw stats.hoursWorked.
    // stats.hoursWorked is un-rounded/un-capped and would drift from the printed
    // cell at roundHalf / hourly-leave-cap boundaries, silently changing report
    // colors. So we always feed classifyDay hoursWorked = oreOrdinario and only
    // BORROW anomalies/entries from the real stats (for the issue panel).
    const realStats = statsForDay ? statsForDay(d) : null;
    const dailyStats: DailyStats | null =
      realStats || oreOrdinario > 0
        ? ({
            employeeId: realStats?.employeeId ?? "",
            employeeName: realStats?.employeeName ?? "",
            date: dateStr,
            hoursWorked: oreOrdinario, // PRINTED value → effectiveHours === totale
            hoursWorkedMsg: 0, pauseMinutes: 0, pauses: [],
            morningDelay: 0, afternoonDelay: 0, overtime: 0, overtimeBlocks: [],
            hasAnomaly: (realStats?.anomalies.length ?? 0) > 0,
            anomalies: realStats?.anomalies ?? [],
            entries: realStats?.entries ?? [],
            exits: realStats?.exits ?? [],
          } as DailyStats)
        : null;
    out.set(
      d,
      classifyDay({
        date: dateStr,
        scheduledHours,
        dailyStats,
        leaveHours,
        isNonWorkingDay: isNonWorkingDay(dateStr),
        isActiveOnDay: isActiveOnDay(dateStr),
      }),
    );
  }
  return out;
}

// ── Builder dati presenze ─────────────────────────────────────────────

/**
 * Recupera dal DB e costruisce i dati mensili delle presenze.
 * Riutilizzabile sia dall'export route sia dal worker dei report mensili.
 */
export async function buildPresenzeMonthData(
  year: number,
  month: number
): Promise<PresenzeMonthData> {
  const yearStr = String(year);
  const monthStr = String(month).padStart(2, "0");
  const nDays = new Date(year, month, 0).getDate();
  const from = `${yearStr}-${monthStr}-01`;
  const to = `${yearStr}-${monthStr}-${String(nDays).padStart(2, "0")}`;

  // ── 1. Employees (tutti, anche quelli senza record nel mese) ─────
  const employees = await prisma.employee.findMany({
    where: activeOnWhere(to), // attivi nel mese: esclude chi e' cessato prima del mese
    select: {
      id: true,
      name: true,
      displayName: true,
      contractType: true,
      hireDate: true, // per isActiveOn(emp, dateStr) nella classificazione per-giorno
      terminationDate: true,
    },
    orderBy: { name: "asc" },
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
      // eslint-disable-next-line local/no-iso-split -- UTC day key matches LeaveRequest.startDate (UTC midnight) used by `${r.employeeId}-${r.date}` lookups
      const dateStr = cur.toISOString().split("T")[0];
      const key = `${l.employeeId}|${dateStr}`;
      if (!leaveMap.has(key)) {
        leaveMap.set(key, { type: l.type, hours: l.hours ?? null });
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
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

  // Calcola DailyStats per ogni (employee, date) che abbia record
  const hoursMap = new Map<string, number>(); // "employeeId|YYYY-MM-DD" → hoursWorked
  const statsMap = new Map<string, DailyStats>(); // "employeeId|YYYY-MM-DD" → stats
  for (const dr of grouped.values()) {
    const dayOfWeek = getDayOfWeek(dr.date);
    const empSchedule = scheduleMap.get(dr.employeeId)?.get(dayOfWeek) ?? null;
    const stats = calculateDailyStats(dr, empSchedule);
    hoursMap.set(`${dr.employeeId}|${dr.date}`, stats.hoursWorked);
    statsMap.set(`${dr.employeeId}|${dr.date}`, stats);
  }

  // ── 6. Build PresenzeEmployeeData per ogni employee ──────────────
  const presenzeEmployees: PresenzeEmployeeData[] = [];

  for (const emp of employees) {
    const days = new Map<number, PresenzeDayData>();
    const scheduledHoursPerDay = new Map<number, number>();
    let overtimeTotal = 0;

    for (let d = 1; d <= nDays; d++) {
      const dateStr = `${yearStr}-${monthStr}-${String(d).padStart(2, "0")}`;
      const keyHours = `${emp.id}|${dateStr}`;
      const keyLeave = `${emp.id}|${dateStr}`;

      const hoursWorked = hoursMap.get(keyHours) ?? 0;
      const leave = leaveMap.get(keyLeave);

      // Ore pianificate per questo giorno specifico (dipende dal giorno della settimana)
      const dayOfWeek = getDayOfWeek(dateStr);
      const daySchedule = scheduleMap.get(emp.id)?.get(dayOfWeek) ?? null;
      const scheduledHours = scheduledHoursForDay(daySchedule);
      if (scheduledHours > 0) {
        scheduledHoursPerDay.set(d, scheduledHours);
      }

      let oreOrdinario: number | null = null;
      let oreFuoriSede: number | null = null;

      if (leave) {
        if (FULL_DAY_LEAVE_TYPES.has(leave.type)) {
          oreOrdinario = null;
          // La ferie vale le ore pianificate quel giorno (es. 4h se part-time, 8h se giornata piena)
          oreFuoriSede = scheduledHours > 0 ? roundHalf(scheduledHours) : 8;
        } else if (HALF_DAY_LEAVE_TYPES.has(leave.type)) {
          // Se la giornata ha ≤4h pianificate (es. part-time), "ferie mattina/pomeriggio" = intera giornata
          const isShortDay = scheduledHours > 0 && scheduledHours <= 4;
          oreOrdinario = hoursWorked > 0 ? roundHalf(hoursWorked) : null;
          oreFuoriSede = isShortDay
            ? roundHalf(scheduledHours)
            : scheduledHours > 0 ? roundHalf(scheduledHours / 2) : 4;
        } else {
          // ROL / MEDICAL_VISIT / altri a ore
          const leaveHours = leave.hours ?? 0;
          const rawFuoriSede = leaveHours > 0 ? roundHalf(leaveHours) : null;
          // Cap oreOrdinario so that ordinario + fuoriSede never exceeds scheduledHours
          // (avoids false-positive yellow when worked hours + leave > scheduledHours)
          let rawOrdinario = hoursWorked > 0 ? roundHalf(hoursWorked) : null;
          if (rawOrdinario !== null && rawFuoriSede !== null && scheduledHours > 0) {
            const maxOrdinario = roundHalf(scheduledHours - rawFuoriSede);
            rawOrdinario = maxOrdinario > 0 ? Math.min(rawOrdinario, maxOrdinario) : null;
          }
          oreOrdinario = rawOrdinario;
          oreFuoriSede = rawFuoriSede;
        }
      } else if (hoursWorked > 0) {
        // Giorno lavorativo puro: calcola straordinari e ore nette
        const effectiveSoglia = scheduledHours > 0 ? scheduledHours : (CONTRACT_HOURS[emp.contractType] ?? 8);
        const overtime = Math.max(0, hoursWorked - effectiveSoglia);
        overtimeTotal += overtime;
        oreOrdinario = roundHalf(hoursWorked - overtime); // ore nette al netto degli straordinari
      }

      if (oreOrdinario !== null || oreFuoriSede !== null) {
        days.set(d, { oreOrdinario, oreFuoriSede });
      }
    }

    const classifications = classifyEmployeeDays(
      {
        employeeId: emp.id,
        displayName: (emp.displayName || emp.name).toUpperCase(),
        contractType: emp.contractType,
        days,
        straordinari: roundQuarter(overtimeTotal),
        scheduledHoursPerDay,
        classifications: new Map(),
      },
      year,
      month,
      (dateStr) => isActiveOn(emp, dateStr),
      (d) => {
        const dateStr = `${yearStr}-${monthStr}-${String(d).padStart(2, "0")}`;
        return statsMap.get(`${emp.id}|${dateStr}`) ?? null;
      },
    );

    presenzeEmployees.push({
      employeeId: emp.id,
      displayName: (emp.displayName || emp.name).toUpperCase(),
      contractType: emp.contractType,
      days,
      straordinari: roundQuarter(overtimeTotal),
      scheduledHoursPerDay,
      classifications,
    });
  }

  // Ordina per cognome (prima parola del displayName)
  presenzeEmployees.sort((a, b) => {
    const lastA = a.displayName.split(" ")[0];
    const lastB = b.displayName.split(" ")[0];
    return lastA.localeCompare(lastB);
  });

  return { year, month, employees: presenzeEmployees };
}
