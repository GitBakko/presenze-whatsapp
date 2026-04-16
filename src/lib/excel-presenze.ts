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
import {
  calculateDailyStats,
  type DailyRecord,
  type EmployeeScheduleDay,
} from "./calculator";

// ── Dati di input ────────────────────────────────────────────────────

export interface PresenzeDayData {
  oreOrdinario: number | null;
  oreFuoriSede: number | null;
}

export interface PresenzeEmployeeData {
  displayName: string; // "COGNOME NOME" (gia' uppercase)
  days: Map<number, PresenzeDayData>; // giorno 1-31 → dati
  buoniPasto: number;
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

  // "buoni pasto" header: Calibri 11 normal, nessun bordo
  const buoniHeader = row2.getCell(BUONI_COL);
  buoniHeader.value = "buoni pasto";
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
      }
    }

    // Col "buoni pasto"
    const buoniO = rO.getCell(BUONI_COL);
    buoniO.value = emp.buoniPasto;
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
      const dateStr = cur.toISOString().split("T")[0];
      const key = `${l.employeeId}|${dateStr}`;
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

  return { year, month, employees: presenzeEmployees };
}
