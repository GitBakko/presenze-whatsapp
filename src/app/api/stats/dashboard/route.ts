import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  calculateDailyStats,
  type DailyRecord,
  type DailyStats,
  type EmployeeScheduleDay,
} from "@/lib/calculator";
import { checkAuthAny, isAuthUser, resolveEmployeeId } from "@/lib/auth-guard";
import { computeLeaveBalance } from "@/lib/leaves";
import { isNonWorkingDay, getNonWorkingDayLabel } from "@/lib/holidays-it";
import { getDayOfWeek, hmToMinutes } from "@/lib/date-utils";
import {
  computeRanges,
  computeKpis,
  computeAssenzeChart,
  MESI_ABBR,
} from "@/lib/dashboard-helpers";
import type {
  DashboardStatsResponse,
  EmployeeTodayStatus,
  EmployeeStatus,
  AnomalyRecent,
  LeaveBalanceRow,
  OreChartPoint,
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
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;
  const isAdmin = authResult.role === "ADMIN";

  // Il JWT potrebbe avere employeeId=null se è stato creato prima
  // dell'attivazione admin. resolveEmployeeId() fa fallback al DB.
  const selfEmployeeId = await resolveEmployeeId(authResult);


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

  // ── Giorno non lavorativo ────────────────────────────────────────────
  const isNonWorkingToday = isNonWorkingDay(today);
  const nonWorkingLabel = getNonWorkingDayLabel(today);

  const todaySection = isNonWorkingToday
    ? {
        totalEmployees,
        presenti: 0,
        assenti: 0,
        ferie: ferieTodayCount,
        malattia: malattiaTodayCount,
        anomalieAperte: anomaliesUnresolved,
      }
    : {
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
    // Se oggi è non lavorativo, tutti hanno status "nonWorking"
    if (isNonWorkingToday) {
      return {
        id: emp.id,
        name: emp.displayName || emp.name,
        avatarUrl: emp.avatarUrl,
        status: "nonWorking" as EmployeeStatus,
        entryTime: null,
        delayMinutes: 0,
        label: nonWorkingLabel,
      };
    }

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

  // Ordina: presenti > in ritardo > assenti > malattia > ferie > nonWorking, poi per nome
  const statusOrder: Record<EmployeeStatus, number> = {
    present: 0, late: 1, absent: 2, sick: 3, vacation: 4, nonWorking: 5,
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

  // ── Filtro employee: i dipendenti vedono solo i propri dati ─────────
  // Se l'utente e' EMPLOYEE, SEMPRE filtra — anche se selfEmployeeId
  // e' null (account non ancora associato a un dipendente).
  if (!isAdmin) {
    if (!selfEmployeeId) {
      // Employee senza associazione: dashboard vuota
      const emptyResponse: DashboardStatsResponse = {
        period, generatedAt: new Date().toISOString(),
        isNonWorkingToday, nonWorkingLabel,
        today: { totalEmployees: 0, presenti: 0, assenti: 0, ferie: 0, malattia: 0, anomalieAperte: 0 },
        kpi: {
          tassoPresenza: { value: 0, delta: 0 }, tassoPuntualita: { value: 0, delta: 0 },
          ritardoMedioMin: { value: 0, delta: 0 }, tassoAssenteismo: { value: 0, delta: 0 },
          oreStraordTotali: { value: 0, delta: 0 }, oreLavorateMediaDip: { value: 0, delta: 0 },
          giorniMalattia: { value: 0, delta: 0 }, percAnomalieRisolte: { value: 0, delta: 0 },
        },
        employeesToday: [], anomalieRecenti: [], leaveBalances: [],
      };
      return NextResponse.json(emptyResponse);
    }
    // KPI: ricalcola solo per il proprio ID
    const ownCurrent = currentStats.filter((d) => d.employeeId === selfEmployeeId);
    const ownPrev = prevStats.filter((d) => d.employeeId === selfEmployeeId);
    const ownLeaves = periodLeaves.filter((l) => l.employeeId === selfEmployeeId);
    const ownPrevLeaves = prevPeriodLeaves.filter((l) => l.employeeId === selfEmployeeId);
    const ownKpi = computeKpis(
      ownCurrent, ownPrev, ownLeaves, ownPrevLeaves,
      1, from, to, prevFrom, prevTo,
      anomaliesResolvedPeriod, anomaliesTotalPeriod,
      anomaliesResolvedPrev, anomaliesTotalPrev
    );

    const ownBalance = leaveBalances.filter((b) => b.employeeId === selfEmployeeId);
    const ownTodayStatus = employeesToday.find((e) => e.id === selfEmployeeId);

    // Sezione A per employee: dati personali, non globali
    const ownTodaySection = {
      totalEmployees: 1,
      presenti: ownTodayStatus?.status === "present" || ownTodayStatus?.status === "late" ? 1 : 0,
      assenti: ownTodayStatus?.status === "absent" ? 1 : 0,
      ferie: ownTodayStatus?.status === "vacation" ? 1 : 0,
      malattia: ownTodayStatus?.status === "sick" ? 1 : 0,
      anomalieAperte: 0,
    };

    // Grafici filtrati per il dipendente
    const ownCharts: DashboardStatsResponse["charts"] = {};
    if (chart === "ore_mensili" || chart === "all") {
      const ownEmployee = allEmployees.filter((e) => e.id === selfEmployeeId);
      ownCharts.oreMensili = await computeOreChart(
        chartMonths, scheduleMap, ownEmployee, dismissedSet, selfEmployeeId
      );
    }
    if (chart === "assenze_tipologia" || chart === "all") {
      ownCharts.assenzeTipologia = computeAssenzeChart(ownLeaves, from, to);
    }

    const response: DashboardStatsResponse = {
      period,
      generatedAt: new Date().toISOString(),
      isNonWorkingToday,
      nonWorkingLabel,
      today: ownTodaySection,
      kpi: ownKpi,
      charts: Object.keys(ownCharts).length > 0 ? ownCharts : undefined,
      employeesToday: ownTodayStatus ? [ownTodayStatus] : [],
      anomalieRecenti: [],
      leaveBalances: ownBalance,
    };
    return NextResponse.json(response);
  }

  // ── Response admin (completa) ──────────────────────────────────────
  const response: DashboardStatsResponse = {
    period,
    generatedAt: new Date().toISOString(),
    isNonWorkingToday,
    nonWorkingLabel,
    today: todaySection,
    kpi,
    charts: Object.keys(charts).length > 0 ? charts : undefined,
    employeesToday,
    anomalieRecenti,
    leaveBalances,
  };

  return NextResponse.json(response);
}

// ── Chart: ore mensili ───────────────────────────────────────────────

async function computeOreChart(
  months: number,
  scheduleMap: Map<string, Map<number, EmployeeScheduleDay>>,
  allEmployees: { id: string; contractType: string }[],
  dismissedSet: Set<string>,
  filterEmployeeId?: string | null,
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
            mins += hmToMinutes(sched.block1End) - hmToMinutes(sched.block1Start);
          if (sched.block2Start && sched.block2End)
            mins += hmToMinutes(sched.block2End) - hmToMinutes(sched.block2Start);
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
    const recordsWhere: Record<string, unknown> = { date: { gte: mFrom, lte: mTo } };
    if (filterEmployeeId) recordsWhere.employeeId = filterEmployeeId;
    const records = await prisma.attendanceRecord.findMany({
      where: recordsWhere,
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

