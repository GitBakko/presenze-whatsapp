/**
 * Pure computation helpers for the dashboard endpoint.
 *
 * Extracted from /api/stats/dashboard/route.ts for testability
 * and reduced file size. None of these functions access the database.
 */

import { isNonWorkingDay } from "@/lib/holidays-it";
import { hmToMinutes } from "@/lib/date-utils";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import type { DailyStats } from "@/lib/calculator";
import type {
  DashboardStatsResponse,
  KpiValue,
  AssenzaChartPoint,
} from "@/types/dashboard";

// ── Period ranges ───────────────────────────────────────────────────────

export function computeRanges(period: "today" | "month" | "quarter", now: Date) {
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
  const pqStart = new Date(qStart.getFullYear(), qStart.getMonth() - 3, 1);
  const pqEnd = new Date(qStart.getFullYear(), qStart.getMonth(), 0);
  const prevFrom = `${pqStart.getFullYear()}-${String(pqStart.getMonth() + 1).padStart(2, "0")}-01`;
  const prevTo = `${pqEnd.getFullYear()}-${String(pqEnd.getMonth() + 1).padStart(2, "0")}-${pqEnd.getDate()}`;
  return { from, to, prevFrom, prevTo };
}

// ── Count working days ──────────────────────────────────────────────────

export function countWorkDays(from: string, to: string): number {
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

// ── KPI computation ─────────────────────────────────────────────────────

export type LeaveForKpi = {
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
  employeeId: string;
};

export function computeKpis(
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

    const presenceDays = new Set(stats.filter((d) => d.entries.length > 0).map((d) => `${d.employeeId}|${d.date}`)).size;
    const tassoPresenza = possibleDays > 0 ? (presenceDays / possibleDays) * 100 : 0;

    // ROL mattutini per ridurre il ritardo coperto
    const morningRolMinutes = new Map<string, number>();
    for (const l of leaves) {
      if (!l.timeSlots) continue;
      try {
        const slots = JSON.parse(l.timeSlots) as { from: string; to: string }[];
        for (const slot of slots) {
          if (hmToMinutes(slot.from) < 720) {
            const mins = hmToMinutes(slot.to) - hmToMinutes(slot.from);
            if (mins > 0) {
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

    const absenceDays = possibleDays - presenceDays;
    const tassoAssenteismo = possibleDays > 0 ? (absenceDays / possibleDays) * 100 : 0;

    const oreStraordTotali = stats.reduce((s, d) => s + d.overtime, 0);

    const empIds = new Set(stats.map((d) => d.employeeId));
    const totalHours = stats.reduce((s, d) => s + d.hoursWorked, 0);
    const oreLavorateMediaDip = empIds.size > 0 ? totalHours / empIds.size : 0;

    const giorniMalattia = leaves
      .filter((l) => l.type === "SICK")
      .reduce((sum, l) => {
        const s = l.startDate < rangeFrom ? rangeFrom : l.startDate;
        const e = l.endDate > rangeTo ? rangeTo : l.endDate;
        const diff = (new Date(e).getTime() - new Date(s).getTime()) / (1000 * 60 * 60 * 24) + 1;
        return sum + Math.max(0, diff);
      }, 0);

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

// ── Chart: assenze tipologia ────────────────────────────────────────────

export function computeAssenzeChart(
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
    Ferie: "#DAEAFE",
    Malattia: "#FFE2E2",
    ROL: "#FEF3C7",
    Permessi: "#FEF3C7",
    Altro: "#F2E8FF",
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

// ── Month abbreviations ─────────────────────────────────────────────────

export const MESI_ABBR = ["", "Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
