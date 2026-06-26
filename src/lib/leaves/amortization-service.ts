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
import { computeLeaveBalanceFromData } from "./balance";
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
  trigger: "PAYROLL_IMPORT" | "MANUAL",
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
  const [balances, allLeaves] = await Promise.all([
    prisma.leaveBalance.findMany({ where: { employeeId: { in: empIds }, year } }),
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: empIds }, status: "APPROVED", startDate: { gte: yearStart, lte: yearEnd } },
    }),
  ]);
  const balByEmp = new Map(balances.map((b) => [b.employeeId, b]));
  const leavesByEmp = new Map<string, typeof allLeaves>();
  for (const l of allLeaves) {
    const arr = leavesByEmp.get(l.employeeId) ?? [];
    arr.push(l);
    leavesByEmp.set(l.employeeId, arr);
  }

  // Build amort inputs from CURRENT balance (already nets out goduti + confirmed
  // predictor leaves → the day-residual formula of rule 2 holds automatically).
  const inputs: EmployeeAmortInput[] = employees.map((e) => {
    const leaves = leavesByEmp.get(e.id) ?? [];
    const bal = computeLeaveBalanceFromData(
      { id: e.id, hireDate: e.hireDate, terminationDate: e.terminationDate, contractType: e.contractType, schedule: e.schedule },
      balByEmp.get(e.id) ?? null,
      leaves.map((l) => ({ type: l.type, startDate: l.startDate, endDate: l.endDate, hours: l.hours, timeSlots: l.timeSlots, source: l.source })),
      year,
      now,
    );
    // Occupied = every date covered by an existing approved leave (predictor must
    // never double up on a day the employee is already off).
    const occupiedDates = new Set<string>();
    for (const l of leaves) {
      let cur = l.startDate;
      while (cur <= l.endDate) {
        occupiedDates.add(cur);
        cur = nextDay(cur);
      }
    }
    return {
      id: e.id,
      contractType: e.contractType,
      schedule: e.schedule,
      terminationDate: e.terminationDate,
      vacationRemaining: bal.vacationRemaining,
      rolRemaining: bal.rolRemaining,
      occupiedDates,
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
      const vacDays = dayList.filter((d) => d.type === "VACATION").length;
      const rolDays = dayList.filter((d) => d.type === "ROL").length;
      const inp = poolByEmp.get(employeeId);
      const scrapHours = inp ? computePool(inp).scrapHours : 0;
      perEmployee.push({ employeeId, generated: dayList.length, vacDays, rolDays, scrapHours });
      for (const d of dayList) {
        rows.push({
          employeeId,
          type: d.type,
          startDate: d.date,
          endDate: d.date,
          hours: d.type === "ROL" ? d.hours ?? null : null,
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
