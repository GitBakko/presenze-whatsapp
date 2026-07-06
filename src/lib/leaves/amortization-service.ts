/**
 * Amortization recompute service — the DB-facing orchestration around the pure
 * `planAmortization` engine.
 *
 * Trigger points: confirm of a payroll-tabulato import (decision D9) and a manual
 * "Ricalcola" action. On each run it (decision D10):
 *   1. wipes ONLY unconfirmed FUTURE predictor leaves (keeps past + HR-confirmed),
 *   2. recomputes residuals from the freshly-certified balances — which already
 *      net out goduti + confirmed-predictor days, satisfying the residual formula,
 *   3. regenerates the plan and persists it as APPROVED predictor leaves
 *      (confirmedAt=null = awaiting HR confirmation),
 *   4. records a LeavePredictorRun for observability.
 */
import { prisma } from "../db";
import { computeLeaveBalanceFromData, projectYearEndResidual, getPayrollCutoffEnd } from "./balance";
import { computePool, planAmortization, type EmployeeAmortInput, type PlannedDay } from "./amortization";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export interface RecomputeResult {
  runId: string;
  created: number;
  perEmployee: Array<{ employeeId: string; generated: number; vacDays: number; rolDays: number; scrapHours: number }>;
}

export async function recomputeAmortization(
  year: number,
  trigger: "PAYROLL_IMPORT" | "MANUAL" | "RESCHEDULE",
  actorUserId?: string,
): Promise<RecomputeResult> {
  const now = new Date();
  const today = dateStr(now);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const employees = await prisma.employee.findMany({
    where: { leavePredictorEnabled: true, terminationDate: null },
    include: { schedule: true },
  });

  if (employees.length === 0) {
    const run = await prisma.leavePredictorRun.create({
      data: { triggeredById: actorUserId ?? null, trigger, year, payload: "[]" },
    });
    return { runId: run.id, created: 0, perEmployee: [] };
  }

  const empIds = employees.map((e) => e.id);
  const [balances, allLeaves, cutoffEnd, exclusions] = await Promise.all([
    prisma.leaveBalance.findMany({ where: { employeeId: { in: empIds }, year } }),
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: empIds }, status: "APPROVED", startDate: { gte: yearStart, lte: yearEnd } },
    }),
    getPayrollCutoffEnd(year),
    prisma.leavePredictorExclusion.findMany({
      where: { employeeId: { in: empIds }, date: { gte: yearStart, lte: yearEnd } },
    }),
  ]);
  const balByEmp = new Map(balances.map((b) => [b.employeeId, b]));
  const leavesByEmp = new Map<string, typeof allLeaves>();
  for (const l of allLeaves) {
    const arr = leavesByEmp.get(l.employeeId) ?? [];
    arr.push(l);
    leavesByEmp.set(l.employeeId, arr);
  }
  // Admin-vetoed dates (rischedulazioni): hard-blocked per employee.
  const exclByEmp = new Map<string, Set<string>>();
  for (const x of exclusions) {
    const set = exclByEmp.get(x.employeeId) ?? new Set<string>();
    set.add(x.date);
    exclByEmp.set(x.employeeId, set);
  }

  // The leaves we are about to WIPE (unconfirmed future predictor days) must not
  // influence this run: counting them in the balance would understate the
  // residual (→ nothing to regenerate), and treating them as occupied would
  // block their own dates. Excluding them makes the run idempotent and lets the
  // residual reflect rule 2 (certified − goduto − human/confirmed-predictor).
  const isWiped = (l: { source: string; confirmedAt: Date | null; startDate: string }) =>
    l.source === "PREDICTOR" && l.confirmedAt === null && l.startDate > today;

  // Build amort inputs from CURRENT balance (already nets out goduti + confirmed
  // predictor leaves → the day-residual formula of rule 2 holds automatically).
  const inputs: EmployeeAmortInput[] = employees.map((e) => {
    const leaves = (leavesByEmp.get(e.id) ?? []).filter((l) => !isWiped(l));
    const bal = computeLeaveBalanceFromData(
      { id: e.id, hireDate: e.hireDate, terminationDate: e.terminationDate, contractType: e.contractType, schedule: e.schedule },
      balByEmp.get(e.id) ?? null,
      leaves.map((l) => ({ type: l.type, startDate: l.startDate, endDate: l.endDate, hours: l.hours, timeSlots: l.timeSlots, source: l.source })),
      year,
      now,
      cutoffEnd,
    );
    // Occupied = every date covered by an existing approved leave we are keeping
    // (predictor must never double up on a day the employee is already off).
    const occupiedDates = new Set<string>();
    for (const l of leaves) {
      let cur = l.startDate;
      while (cur <= l.endDate) {
        occupiedDates.add(cur);
        cur = nextDay(cur);
      }
    }
    // Amortise the PROJECTED year-end monte: current residual + the accrual still
    // to come (2 ferie + 4 ROL h per month). Spreading only today's residual would
    // leave the rest-of-year accrual unamortised → monte not zeroed at 31/12.
    const projected = projectYearEndResidual(
      bal.vacationRemaining, bal.rolRemaining, bal.weeklyHours, now, year, e.terminationDate,
    );
    return {
      id: e.id,
      contractType: e.contractType,
      schedule: e.schedule,
      terminationDate: e.terminationDate,
      vacationRemaining: projected.vacationRemaining,
      rolRemaining: projected.rolRemaining,
      occupiedDates,
      excludedDates: exclByEmp.get(e.id),
    };
  });

  const plan = planAmortization(inputs, now, yearEnd);
  const poolByEmp = new Map(inputs.map((i) => [i.id, i]));

  const perEmployee: RecomputeResult["perEmployee"] = [];
  let created = 0;

  const runId = await prisma.$transaction(async (tx) => {
    // Wipe ONLY unconfirmed future predictor leaves.
    await tx.leaveRequest.deleteMany({
      where: { employeeId: { in: empIds }, source: "PREDICTOR", confirmedAt: null, startDate: { gt: today } },
    });

    const rows: Array<Record<string, unknown>> = [];
    for (const [employeeId, days] of plan) {
      const dayList = days as PlannedDay[];
      // Every planned day is a whole ferie day now; the pool's vac/rol split is
      // kept only for audit transparency (how much came from ROL conversion).
      const inp = poolByEmp.get(employeeId);
      const pool = inp ? computePool(inp) : null;
      perEmployee.push({
        employeeId,
        generated: dayList.length,
        vacDays: pool?.vacWholeDays ?? dayList.length,
        rolDays: pool?.rolWholeDays ?? 0,
        scrapHours: pool?.scrapHours ?? 0,
      });
      for (const d of dayList) {
        rows.push({
          employeeId,
          type: d.type, // always VACATION
          startDate: d.date,
          endDate: d.date,
          hours: null,
          status: "APPROVED",
          source: "PREDICTOR",
          confirmedAt: null,
        });
      }
    }
    created = rows.length;
    if (rows.length > 0) await tx.leaveRequest.createMany({ data: rows as never });

    const run = await tx.leavePredictorRun.create({
      data: { triggeredById: actorUserId ?? null, trigger, year, payload: JSON.stringify(perEmployee) },
    });
    return run.id;
  });

  return { runId, created, perEmployee };
}
