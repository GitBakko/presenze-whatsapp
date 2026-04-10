import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  calculateDailyStats,
  type DailyRecord,
  type DailyStats,
  type EmployeeScheduleDay,
} from "@/lib/calculator";
import { checkAuth } from "@/lib/auth-guard";
import { computeLeaveBalance } from "@/lib/leaves";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import { isNonWorkingDay } from "@/lib/holidays-it";
import type {
  DashboardStatsResponse,
  EmployeeTodayStatus,
  EmployeeStatus,
  AnomalyRecent,
  LeaveBalanceRow,
  OreChartPoint,
  AssenzaChartPoint,
  KpiValue,
} from "@/types/dashboard";

/**
 * GET /api/stats/dashboard
 *
 * Endpoint principale per la dashboard HR. Restituisce tutto il
 * necessario per popolare la dashboard in una singola request.
 *
 * Query params:
 *   period: 'today' | 'month' | 'quarter'  (default 'month')
 *   chart:  'ore_mensili' | 'assenze_tipologia' | 'all' | undefined
 *   months: number (default 8, solo per chart=ore_mensili)
 */

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get("period") || "month") as "today" | "month" | "quarter";
  const chart = searchParams.get("chart") || "all";
  const chartMonths = parseInt(searchParams.get("months") || "8", 10);

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-based

  // ── Calcola range corrente e precedente ────────────────────────────
  const { from, to, prevFrom, prevTo } = computeRanges(period, now);

  // ── Parallel data fetching ─────────────────────────────────────────
  const [
    allEmployees,
    schedules,
    todayRecords,
    currentRecords,
    prevRecords,
    todayLeaves,
    periodLeaves,
    prevPeriodLeaves,
    anomaliesUnresolved,
    _anomaliesTotal,
    anomaliesResolvedPeriod,
    anomaliesTotalPeriod,
    anomaliesResolvedPrev,
    anomaliesTotalPrev,
    recentAnomalies,
    dismissedAnomalies,
  ] = await Promise.all([
    prisma.employee.findMany({
      select: { id: true, name: true, displayName: true, avatarUrl: true, contractType: true },
    }),
    prisma.employeeSchedule.findMany(),
    // Records di oggi (per sezione A + D)
    prisma.attendanceRecord.findMany({
      where: { date: today },
      include: { employee: true },
      orderBy: { declaredTime: "asc" },
    }),
    // Records del periodo corrente (per KPI sezione B)
    prisma.attendanceRecord.findMany({
      where: { date: { gte: from, lte: to } },
      include: { employee: true },
      orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
    }),
    // Records del periodo precedente (per delta)
    prisma.attendanceRecord.findMany({
      where: { date: { gte: prevFrom, lte: prevTo } },
      include: { employee: true },
      orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
    }),
    // Leaves approvati di oggi (per sezione D)
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } },
    }),
    // Leaves del periodo corrente (per KPI malattia + assenteismo)
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
    }),
    // Leaves del periodo precedente (per delta)
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: prevTo }, endDate: { gte: prevFrom } },
    }),
    // Anomalie non risolte globali (per sezione A)
    prisma.anomaly.count({ where: { resolved: false, date: today } }),
    prisma.anomaly.count({ where: { date: today } }),
    // Anomalie risolte/totali nel periodo (per KPI % risolta)
    prisma.anomaly.count({ where: { resolved: true, date: { gte: from, lte: to } } }),
    prisma.anomaly.count({ where: { date: { gte: from, lte: to } } }),
    prisma.anomaly.count({ where: { resolved: true, date: { gte: prevFrom, lte: prevTo } } }),
    prisma.anomaly.count({ where: { date: { gte: prevFrom, lte: prevTo } } }),
    // Ultime 4 anomalie non risolte per sezione D
    prisma.anomaly.findMany({
      where: { resolved: false },
      include: { employee: true },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 20, // prendiamo di più e ordiniamo per severity in JS
    }),
    prisma.anomaly.findMany({
      where: { resolved: true },
      select: { employeeId: true, date: true, type: true, description: true },
    }),
  ]);

  // ── Schedule map ───────────────────────────────────────────────────
  const scheduleMap = new Map<string, Map<number, EmployeeScheduleDay>>();
  for (const s of schedules) {
    if (!scheduleMap.has(s.employeeId)) scheduleMap.set(s.employeeId, new Map());
    scheduleMap.get(s.employeeId)!.set(s.dayOfWeek, {
      block1Start: s.block1Start, block1End: s.block1End,
      block2Start: s.block2Start, block2End: s.block2End,
    });
  }

  const dismissedSet = new Set(
    dismissedAnomalies.map((d) => `${d.employeeId}|${d.date}|${d.type}|${d.description}`)
  );

  // ── Helper: calcola stats da records ───────────────────────────────
  function calcStats(records: typeof todayRecords): DailyStats[] {
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

  const todayStatsArr = calcStats(todayRecords);
  const currentStats = calcStats(currentRecords);
  const prevStats = calcStats(prevRecords);

  const totalEmployees = allEmployees.length;

  // ── SEZIONE A — Riepilogo Oggi ─────────────────────────────────────
  const todayLeaveMap = new Map<string, string>();
  for (const l of todayLeaves) {
    todayLeaveMap.set(l.employeeId, l.type);
  }

  const presentTodayIds = new Set(
    todayStatsArr.filter((d) => d.entries.length > 0).map((d) => d.employeeId)
  );
  const ferieTodayCount = [...todayLeaveMap.values()].filter((t) =>
    ["VACATION", "VACATION_HALF_AM", "VACATION_HALF_PM"].includes(t)
  ).length;
  const malattiaTodayCount = [...todayLeaveMap.values()].filter((t) => t === "SICK").length;
  const assentiToday = totalEmployees - presentTodayIds.size - ferieTodayCount - malattiaTodayCount;

  const todaySection = {
    totalEmployees,
    presenti: presentTodayIds.size,
    assenti: Math.max(0, assentiToday),
    ferie: ferieTodayCount,
    malattia: malattiaTodayCount,
    anomalieAperte: anomaliesUnresolved,
  };

  // ── SEZIONE B — KPI ────────────────────────────────────────────────
  const kpi = computeKpis(
    currentStats, prevStats,
    periodLeaves, prevPeriodLeaves,
    totalEmployees, from, to, prevFrom, prevTo,
    anomaliesResolvedPeriod, anomaliesTotalPeriod,
    anomaliesResolvedPrev, anomaliesTotalPrev
  );

  // ── SEZIONE D — Dipendenti oggi ────────────────────────────────────
  const employeesToday: EmployeeTodayStatus[] = allEmployees.map((emp) => {
    const dayStats = todayStatsArr.find((d) => d.employeeId === emp.id);
    const leaveType = todayLeaveMap.get(emp.id);

    let status: EmployeeStatus = "absent";
    let entryTime: string | null = null;
    let delayMinutes = 0;
    let label: string | null = null;

    if (leaveType === "SICK") {
      status = "sick";
      label = "Malattia";
    } else if (leaveType && ["VACATION", "VACATION_HALF_AM", "VACATION_HALF_PM"].includes(leaveType)) {
      status = "vacation";
      label = "Ferie";
    } else if (dayStats && dayStats.entries.length > 0) {
      entryTime = dayStats.entries[0];
      delayMinutes = dayStats.morningDelay;
      status = delayMinutes > 15 ? "late" : "present";
    }

    return {
      id: emp.id,
      name: emp.displayName || emp.name,
      avatarUrl: emp.avatarUrl,
      status,
      entryTime,
      delayMinutes,
      label,
    };
  });

  // Ordina: presenti > in ritardo > assenti > malattia > ferie, poi per nome
  const statusOrder: Record<EmployeeStatus, number> = {
    present: 0, late: 1, absent: 2, sick: 3, vacation: 4,
  };
  employeesToday.sort((a, b) => {
    const so = statusOrder[a.status] - statusOrder[b.status];
    if (so !== 0) return so;
    return a.name.localeCompare(b.name);
  });

  // ── SEZIONE D — Anomalie recenti ───────────────────────────────────
  const severityMap: Record<string, number> = {
    MISSING_EXIT: 2, MISSING_ENTRY: 2,
    PAUSE_NO_END: 1, OVERTIME_NO_END: 1, MISMATCHED_PAIRS: 1,
    TIME_OVERLAP: 0, TIME_BLOCK_MISMATCH: 0,
  };
  const anomalieRecenti: AnomalyRecent[] = recentAnomalies
    .map((a) => ({
      id: a.id,
      employeeName: a.employee.displayName || a.employee.name,
      type: a.type,
      description: a.description,
      date: a.date,
      severity: severityMap[a.type] ?? 0,
    }))
    .sort((a, b) => b.severity - a.severity || b.date.localeCompare(a.date))
    .slice(0, 4);

  // ── SEZIONE E — Saldi ferie/ROL ────────────────────────────────────
  const leaveBalances: LeaveBalanceRow[] = [];
  const isH2 = currentMonth >= 6; // luglio in poi
  for (const emp of allEmployees) {
    try {
      const bal = await computeLeaveBalance(emp.id, currentYear);
      const vacTotal = bal.vacationCarryOver + bal.vacationAccrued + bal.vacationAccrualAdjust;
      const vacPercent = vacTotal > 0 ? (bal.vacationUsed / vacTotal) * 100 : 0;
      leaveBalances.push({
        employeeId: emp.id,
        employeeName: emp.displayName || emp.name,
        avatarUrl: emp.avatarUrl,
        vacationUsed: bal.vacationUsed,
        vacationTotal: Math.round(vacTotal * 100) / 100,
        vacationRemaining: bal.vacationRemaining,
        vacationPercent: Math.round(vacPercent * 10) / 10,
        rolRemaining: bal.rolRemaining,
        alert: isH2 && bal.vacationRemaining < 5,
      });
    } catch {
      // skip employees without valid schedule
    }
  }
  leaveBalances.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  // ── SEZIONE C — Grafici (opzionale) ────────────────────────────────
  const charts: DashboardStatsResponse["charts"] = {};

  if (chart === "ore_mensili" || chart === "all") {
    charts.oreMensili = await computeOreChart(
      chartMonths, scheduleMap, allEmployees, dismissedSet
    );
  }

  if (chart === "assenze_tipologia" || chart === "all") {
    charts.assenzeTipologia = computeAssenzeChart(periodLeaves, from, to);
  }

  // ── Response ───────────────────────────────────────────────────────
  const response: DashboardStatsResponse = {
    period,
    generatedAt: new Date().toISOString(),
    today: todaySection,
    kpi,
    charts: Object.keys(charts).length > 0 ? charts : undefined,
    employeesToday,
    anomalieRecenti,
    leaveBalances,
  };

  return NextResponse.json(response);
}

// ── KPI computation ──────────────────────────────────────────────────

type LeaveForKpi = { type: string; startDate: string; endDate: string; hours: number | null; timeSlots: string | null; employeeId: string };

function computeKpis(
  current: DailyStats[],
  prev: DailyStats[],
  currentLeaves: LeaveForKpi[],
  prevLeaves: LeaveForKpi[],
  totalEmployees: number,
  from: string, to: string,
  prevFrom: string, prevTo: string,
  resolvedCurrent: number, totalCurrent: number,
  resolvedPrev: number, totalPrev: number,
): DashboardStatsResponse["kpi"] {

  function calcPeriodKpis(stats: DailyStats[], leaves: LeaveForKpi[], rangeFrom: string, rangeTo: string) {
    const workDays = countWorkDays(rangeFrom, rangeTo);
    const possibleDays = totalEmployees * workDays;

    // Presenze: giorni unici con almeno un entry per dipendente
    const presenceDays = new Set(stats.filter((d) => d.entries.length > 0).map((d) => `${d.employeeId}|${d.date}`)).size;
    const tassoPresenza = possibleDays > 0 ? (presenceDays / possibleDays) * 100 : 0;

    // Costruisci mappa ROL mattutini per sottrarre i minuti coperti dal
    // ritardo: se un dipendente ha un ROL con timeSlots che copre la
    // mattina (es. 09:00-10:00), il ritardo effettivo si riduce di quei
    // minuti. Chiave: "employeeId|date".
    const morningRolMinutes = new Map<string, number>();
    for (const l of leaves) {
      if (!l.timeSlots) continue;
      try {
        const slots = JSON.parse(l.timeSlots) as { from: string; to: string }[];
        for (const slot of slots) {
          // Consideriamo "mattutino" un slot che inizia prima delle 12:00
          if (hmToMin(slot.from) < 720) {
            const mins = hmToMin(slot.to) - hmToMin(slot.from);
            if (mins > 0) {
              // Il leave può coprire più giorni; distribuiamo su ogni giorno del range
              const s = l.startDate < rangeFrom ? rangeFrom : l.startDate;
              const e = l.endDate > rangeTo ? rangeTo : l.endDate;
              const cur = new Date(s);
              const end = new Date(e);
              while (cur <= end) {
                const dateStr = cur.toISOString().split("T")[0];
                const key = `${l.employeeId}|${dateStr}`;
                morningRolMinutes.set(key, (morningRolMinutes.get(key) ?? 0) + mins);
                cur.setDate(cur.getDate() + 1);
              }
            }
          }
        }
      } catch {
        // timeSlots malformato, ignora
      }
    }

    // Puntualità e ritardo: sottraiamo i minuti ROL mattutini dal delay
    let latePunches = 0;
    let totalDelayMinutes = 0;
    let delayCount = 0;
    for (const d of stats) {
      let morningDelay = d.morningDelay;
      const rolKey = `${d.employeeId}|${d.date}`;
      const rolCover = morningRolMinutes.get(rolKey) ?? 0;
      if (rolCover > 0 && morningDelay > 0) {
        morningDelay = Math.max(0, morningDelay - rolCover);
      }
      const totalDelay = morningDelay + d.afternoonDelay;
      if (totalDelay > 0) {
        latePunches++;
        totalDelayMinutes += totalDelay;
        delayCount++;
      }
    }
    const totalPunches = stats.length;
    const tassoPuntualita = totalPunches > 0 ? ((totalPunches - latePunches) / totalPunches) * 100 : 100;
    const ritardoMedioMin = delayCount > 0 ? totalDelayMinutes / delayCount : 0;

    // Assenteismo: giorni senza presenza / giorni possibili
    const absenceDays = possibleDays - presenceDays;
    const tassoAssenteismo = possibleDays > 0 ? (absenceDays / possibleDays) * 100 : 0;

    // Straordinario
    const oreStraordTotali = stats.reduce((s, d) => s + d.overtime, 0);

    // Ore lavorate medie per dipendente
    const empIds = new Set(stats.map((d) => d.employeeId));
    const totalHours = stats.reduce((s, d) => s + d.hoursWorked, 0);
    const oreLavorateMediaDip = empIds.size > 0 ? totalHours / empIds.size : 0;

    // Giorni malattia
    const giorniMalattia = leaves
      .filter((l) => l.type === "SICK")
      .reduce((sum, l) => {
        const s = l.startDate < rangeFrom ? rangeFrom : l.startDate;
        const e = l.endDate > rangeTo ? rangeTo : l.endDate;
        const diff = (new Date(e).getTime() - new Date(s).getTime()) / (1000 * 60 * 60 * 24) + 1;
        return sum + Math.max(0, diff);
      }, 0);

    // % anomalie risolte (passate come param)
    return {
      tassoPresenza, tassoPuntualita, ritardoMedioMin,
      tassoAssenteismo, oreStraordTotali, oreLavorateMediaDip,
      giorniMalattia,
    };
  }

  const cur = calcPeriodKpis(current, currentLeaves, from, to);
  const prv = calcPeriodKpis(prev, prevLeaves, prevFrom, prevTo);

  const percResCur = totalCurrent > 0 ? (resolvedCurrent / totalCurrent) * 100 : 100;
  const percResPrev = totalPrev > 0 ? (resolvedPrev / totalPrev) * 100 : 100;

  function kv(curVal: number, prevVal: number): KpiValue {
    return {
      value: Math.round(curVal * 10) / 10,
      delta: Math.round((curVal - prevVal) * 10) / 10,
    };
  }

  return {
    tassoPresenza: kv(cur.tassoPresenza, prv.tassoPresenza),
    tassoPuntualita: kv(cur.tassoPuntualita, prv.tassoPuntualita),
    ritardoMedioMin: kv(cur.ritardoMedioMin, prv.ritardoMedioMin),
    tassoAssenteismo: kv(cur.tassoAssenteismo, prv.tassoAssenteismo),
    oreStraordTotali: kv(cur.oreStraordTotali, prv.oreStraordTotali),
    oreLavorateMediaDip: kv(cur.oreLavorateMediaDip, prv.oreLavorateMediaDip),
    giorniMalattia: kv(cur.giorniMalattia, prv.giorniMalattia),
    percAnomalieRisolte: kv(percResCur, percResPrev),
  };
}

// ── Chart: ore mensili ───────────────────────────────────────────────

const MESI_ABBR = ["", "Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

async function computeOreChart(
  months: number,
  scheduleMap: Map<string, Map<number, EmployeeScheduleDay>>,
  allEmployees: { id: string; contractType: string }[],
  dismissedSet: Set<string>,
): Promise<OreChartPoint[]> {
  const now = new Date();
  const points: OreChartPoint[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const mFrom = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const mTo = `${y}-${String(m).padStart(2, "0")}-${lastDay}`;

    // Ore contratto: somma delle ore giornaliere di ogni dipendente per i giorni lavorativi del mese
    let contratto = 0;
    for (const emp of allEmployees) {
      const empSched = scheduleMap.get(emp.id);
      for (let day = 1; day <= lastDay; day++) {
        const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (isNonWorkingDay(dateStr)) continue;
        const dow = getDayOfWeek(dateStr);
        const sched = empSched?.get(dow);
        if (sched) {
          let mins = 0;
          if (sched.block1Start && sched.block1End)
            mins += hmToMin(sched.block1End) - hmToMin(sched.block1Start);
          if (sched.block2Start && sched.block2End)
            mins += hmToMin(sched.block2End) - hmToMin(sched.block2Start);
          contratto += mins / 60;
        } else if (!empSched || empSched.size === 0) {
          // Nessuno schedule configurato: fallback a 8h per giorno lavorativo
          // solo se il dipendente non ha nessun giorno configurato (per non
          // contare 0 solo perche' manca un singolo giorno della settimana).
          contratto += 8;
        }
        // Se ha lo schedule ma NON per questo giorno specifico della
        // settimana → non lavora quel giorno → 0 ore (non 8h fallback)
      }
    }

    // Ore lavorate
    const records = await prisma.attendanceRecord.findMany({
      where: { date: { gte: mFrom, lte: mTo } },
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
    let lavorate = 0;
    for (const dr of grouped.values()) {
      const dow = getDayOfWeek(dr.date);
      const empSchedule = scheduleMap.get(dr.employeeId)?.get(dow) ?? null;
      const s = calculateDailyStats(dr, empSchedule);
      s.anomalies = s.anomalies.filter(
        (a) => !dismissedSet.has(`${s.employeeId}|${s.date}|${a.type}|${a.description}`)
      );
      lavorate += s.hoursWorked;
    }

    points.push({
      mese: MESI_ABBR[m],
      contratto: Math.round(contratto),
      lavorate: Math.round(lavorate),
    });
  }

  return points;
}

// ── Chart: assenze tipologia ─────────────────────────────────────────

function computeAssenzeChart(
  leaves: { type: string; startDate: string; endDate: string }[],
  from: string, to: string,
): AssenzaChartPoint[] {
  const buckets: Record<string, number> = {
    Ferie: 0,
    Malattia: 0,
    ROL: 0,
    Permessi: 0,
    Altro: 0,
  };
  const colors: Record<string, string> = {
    Ferie: "#1e40af",     // blue-800 — coerente con /leaves TYPE_COLORS
    Malattia: "#991b1b",  // red-800
    ROL: "#92400e",        // amber-800
    Permessi: "#155e75",   // cyan-800 (MEDICAL_VISIT)
    Altro: "#6b21a8",      // purple-800 (BEREAVEMENT, MARRIAGE, LAW_104)
  };

  for (const l of leaves) {
    const s = l.startDate < from ? from : l.startDate;
    const e = l.endDate > to ? to : l.endDate;
    const days = Math.max(0, (new Date(e).getTime() - new Date(s).getTime()) / (1000 * 60 * 60 * 24) + 1);

    const label = LEAVE_TYPES[l.type as LeaveType]?.label ?? l.type;
    if (["VACATION", "VACATION_HALF_AM", "VACATION_HALF_PM"].includes(l.type)) {
      buckets["Ferie"] += days;
    } else if (l.type === "SICK") {
      buckets["Malattia"] += days;
    } else if (l.type === "ROL") {
      buckets["ROL"] += days;
    } else if (["MEDICAL_VISIT"].includes(l.type)) {
      buckets["Permessi"] += days;
    } else {
      buckets["Altro"] += days;
    }
    void label;
  }

  return Object.entries(buckets)
    .filter(([, giorni]) => giorni > 0)
    .map(([tipo, giorni]) => ({
      tipo,
      giorni: Math.round(giorni),
      colore: colors[tipo] || "#B4B2A9",
    }));
}

// ── Helpers ──────────────────────────────────────────────────────────

function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 7 : day;
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function countWorkDays(from: string, to: string): number {
  let count = 0;
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    const dateStr = cur.toISOString().split("T")[0];
    if (!isNonWorkingDay(dateStr)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function computeRanges(period: "today" | "month" | "quarter", now: Date) {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const today = now.toISOString().split("T")[0];

  if (period === "today") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      from: today,
      to: today,
      prevFrom: yesterday.toISOString().split("T")[0],
      prevTo: yesterday.toISOString().split("T")[0],
    };
  }

  if (period === "month") {
    const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const to = `${y}-${String(m + 1).padStart(2, "0")}-${lastDay}`;
    // Mese precedente
    const prevD = new Date(y, m - 1, 1);
    const prevY = prevD.getFullYear();
    const prevM = prevD.getMonth();
    const prevFrom = `${prevY}-${String(prevM + 1).padStart(2, "0")}-01`;
    const prevLastDay = new Date(prevY, prevM + 1, 0).getDate();
    const prevTo = `${prevY}-${String(prevM + 1).padStart(2, "0")}-${prevLastDay}`;
    return { from, to, prevFrom, prevTo };
  }

  // quarter: ultimi 3 mesi interi (incluso il corrente)
  const qStart = new Date(y, m - 2, 1);
  const from = `${qStart.getFullYear()}-${String(qStart.getMonth() + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${lastDay}`;
  // Trimestre precedente
  const pqStart = new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1);
  const pqEnd = new Date(qStart.getFullYear(), qStart.getMonth(), 0);
  const prevFrom = `${pqStart.getFullYear()}-${String(pqStart.getMonth() + 1).padStart(2, "0")}-01`;
  const prevTo = `${pqEnd.getFullYear()}-${String(pqEnd.getMonth() + 1).padStart(2, "0")}-${pqEnd.getDate()}`;
  return { from, to, prevFrom, prevTo };
}
