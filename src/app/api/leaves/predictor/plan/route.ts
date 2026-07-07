import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { todayRome } from "@/lib/tz";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";
import { notifyLeaveCancellation } from "@/lib/telegram-handlers";
import { sendMail } from "@/lib/mail-send";
import { leaveCancellationNotification } from "@/lib/mail-templates";
import { notificationsBus } from "@/lib/notifications-bus";
import {
  computeLeaveBalanceFromData,
  getPayrollCutoffEnd,
  projectYearEndResidual,
  monthlyVacationAccrual,
  monthlyRolAccrual,
} from "@/lib/leaves/balance";
import { computePool } from "@/lib/leaves/amortization";
import { computeMonteTrend, MONTE_DAILY_DIVISOR, type MonteTrendEmployeeInput } from "@/lib/leaves/monte-trend";
import { CONTRACT_DAILY_HOURS } from "@/lib/employees/schedule-fallback";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * GET /api/leaves/predictor/plan
 *
 * Admin-only. Returns the current amortization plan per predictor-enabled
 * employee: residual, unified hour-pool, the predictor leave days (with
 * confirmation state), the admin-vetoed dates (rischedulazioni), and the
 * decision-support data for the preview — current unified monte, the monthly
 * accrual step, and the month-by-month monte trend (burn-down + accrual).
 *
 * Note: residuals are PROJECTED to year-end (current remaining — already net of
 * the predictor days — plus the ferie/ROL still to accrue), so `pool.totalDays`
 * reflects what a fresh recompute would still distribute (≈ 0 right after one).
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const now = new Date();
  const year = now.getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const employees = await prisma.employee.findMany({
    where: { leavePredictorEnabled: true, terminationDate: null },
    include: { schedule: true },
    orderBy: { name: "asc" },
  });
  const empIds = employees.map((e) => e.id);

  const [balances, allLeaves, cutoffEnd, exclusions] = await Promise.all([
    prisma.leaveBalance.findMany({ where: { employeeId: { in: empIds }, year } }),
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: empIds }, status: "APPROVED", startDate: { gte: yearStart, lte: yearEnd } },
      orderBy: { startDate: "asc" },
    }),
    getPayrollCutoffEnd(year),
    // Year-scoped: prior-year vetoes can never block this year's candidates and
    // would render as phantom "giorni esclusi" chips (fmtDate drops the year).
    prisma.leavePredictorExclusion.findMany({
      where: { employeeId: { in: empIds }, date: { gte: yearStart, lte: yearEnd } },
      orderBy: { date: "asc" },
    }),
  ]);
  const balByEmp = new Map(balances.map((b) => [b.employeeId, b]));
  const leavesByEmp = new Map<string, typeof allLeaves>();
  for (const l of allLeaves) {
    const arr = leavesByEmp.get(l.employeeId) ?? [];
    arr.push(l);
    leavesByEmp.set(l.employeeId, arr);
  }
  const exclByEmp = new Map<string, Array<{ id: string; date: string }>>();
  for (const x of exclusions) {
    const arr = exclByEmp.get(x.employeeId) ?? [];
    arr.push({ id: x.id, date: x.date });
    exclByEmp.set(x.employeeId, arr);
  }

  // Month-by-month monte (burn-down + accrual) for ALL enabled employees at once.
  const trendInputs: MonteTrendEmployeeInput[] = employees.map((e) => ({
    id: e.id,
    name: e.displayName || e.name,
    employee: { id: e.id, hireDate: e.hireDate, terminationDate: e.terminationDate, contractType: e.contractType, schedule: e.schedule },
    balance: balByEmp.get(e.id) ?? null,
    leaves: (leavesByEmp.get(e.id) ?? []).map((l) => ({
      type: l.type, startDate: l.startDate, endDate: l.endDate, hours: l.hours, timeSlots: l.timeSlots, source: l.source,
    })),
  }));
  const trend = computeMonteTrend(trendInputs, year, now, cutoffEnd);
  const trendByEmp = new Map(trend.series.map((s) => [s.employeeId, s.points]));

  const result = [];
  for (const e of employees) {
    const leaves = leavesByEmp.get(e.id) ?? [];
    let balance;
    try {
      balance = computeLeaveBalanceFromData(
        { id: e.id, hireDate: e.hireDate, terminationDate: e.terminationDate, contractType: e.contractType, schedule: e.schedule },
        balByEmp.get(e.id) ?? null,
        leaves.map((l) => ({ type: l.type, startDate: l.startDate, endDate: l.endDate, hours: l.hours, timeSlots: l.timeSlots, source: l.source })),
        year,
        now,
        cutoffEnd,
      );
    } catch {
      continue; // skip employees whose balance can't be computed
    }
    const dailyH = CONTRACT_DAILY_HOURS[e.contractType] ?? CONTRACT_DAILY_HOURS.FULL_TIME;
    // Project the residual to year-end (current + future monthly accrual) so the
    // displayed pool matches what a recompute amortises (the predictor zeroes the
    // PROJECTED 31/12 monte, not just today's residual).
    const projected = projectYearEndResidual(
      balance.vacationRemaining, balance.rolRemaining, balance.weeklyHours, now, year, e.terminationDate,
    );
    const pool = computePool({
      id: e.id,
      contractType: e.contractType,
      schedule: e.schedule,
      terminationDate: e.terminationDate,
      vacationRemaining: projected.vacationRemaining,
      rolRemaining: projected.rolRemaining,
      occupiedDates: new Set(),
    });
    const days = leaves.filter((l) => l.source === "PREDICTOR");

    result.push({
      employeeId: e.id,
      name: e.displayName || e.name,
      avatarUrl: e.avatarUrl,
      vacationRemaining: projected.vacationRemaining,
      rolRemaining: projected.rolRemaining,
      dailyH,
      unifiedHours: round2(projected.vacationRemaining * dailyH + projected.rolRemaining),
      // Decision support: today's unified monte (ferie gg + ROL h/8) and the step
      // it grows by at every month change.
      monteTodayDays: round2(balance.vacationRemainingAsOfToday + balance.rolRemainingAsOfToday / MONTE_DAILY_DIVISOR),
      monthlyAccrualDays: round2(
        monthlyVacationAccrual(balance.weeklyHours) + monthlyRolAccrual(balance.weeklyHours) / MONTE_DAILY_DIVISOR,
      ),
      trend: trendByEmp.get(e.id) ?? [],
      pool: {
        vacWholeDays: pool.vacWholeDays,
        rolWholeDays: pool.rolWholeDays,
        scrapHours: pool.scrapHours,
        totalDays: pool.totalDays,
      },
      days: days.map((d) => ({
        id: d.id,
        date: d.startDate,
        type: d.type,
        hours: d.hours,
        confirmedAt: d.confirmedAt?.toISOString() ?? null,
      })),
      exclusions: exclByEmp.get(e.id) ?? [],
    });
  }

  return NextResponse.json({
    year,
    months: trend.months,
    currentMonthLabel: trend.currentMonthLabel,
    employees: result,
  });
}

/**
 * DELETE /api/leaves/predictor/plan[?employeeId=...]
 *
 * Admin-only one-click wipe of the FUTURE predictor days (confirmed AND
 * unconfirmed) — for everyone or, with ?employeeId, a single employee. Past
 * days stay (already enjoyed; the per-day trash covers those). Employees get
 * the cancellation notice only for confirmed days: unconfirmed proposals were
 * never announced to them.
 */
export async function DELETE(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const employeeId = new URL(request.url).searchParams.get("employeeId");
  const today = todayRome();
  const yearEnd = `${new Date().getFullYear()}-12-31`;

  const doomed = await prisma.leaveRequest.findMany({
    where: {
      source: "PREDICTOR",
      startDate: { gt: today, lte: yearEnd },
      ...(employeeId ? { employeeId } : {}),
    },
    include: { employee: true },
    orderBy: { startDate: "asc" },
  });
  if (doomed.length === 0) {
    return NextResponse.json({ deleted: 0, confirmedDeleted: 0 });
  }

  await prisma.leaveRequest.deleteMany({ where: { id: { in: doomed.map((d) => d.id) } } });

  const confirmedDoomed = doomed.filter((d) => d.confirmedAt);
  for (const leave of confirmedDoomed) {
    try {
      await notifyLeaveCancellation({
        employeeChatId: leave.employee.telegramChatId,
        previousStatus: "APPROVED",
        startDate: leave.startDate,
        endDate: leave.endDate,
        reason: "Piano di ammortamento eliminato dall'amministratore",
      });
    } catch (err) {
      console.error("[predictor/plan DELETE] notifyLeaveCancellation failed:", err);
    }
    if (leave.employee.email) {
      try {
        const reply = leaveCancellationNotification({
          previousStatus: "APPROVED",
          startDate: leave.startDate,
          endDate: leave.endDate,
          employeeName: leave.employee.displayName || leave.employee.name,
          reason: "Piano di ammortamento eliminato dall'amministratore",
        });
        await sendMail({ to: leave.employee.email, subject: reply.subject, text: reply.text, html: reply.html });
      } catch (err) {
        console.error("[predictor/plan DELETE] sendMail cancellation failed:", err);
      }
    }
  }

  // One bus event per employee: enough to refresh sidebar + open leave pages.
  const seen = new Set<string>();
  for (const d of doomed) {
    if (seen.has(d.employeeId)) continue;
    seen.add(d.employeeId);
    try {
      notificationsBus.publish({
        employeeId: d.employeeId,
        employeeName: d.employee.displayName || d.employee.name,
        action: "LEAVE_CANCELLED",
        time: LEAVE_TYPES[d.type as LeaveType]?.label ?? d.type,
        date: d.startDate,
        details: {
          leaveId: d.id,
          leaveType: d.type,
          leaveStartDate: d.startDate,
          leaveEndDate: d.endDate,
        },
      });
    } catch (err) {
      console.error("[predictor/plan DELETE] bus publish failed:", err);
    }
  }

  return NextResponse.json({ deleted: doomed.length, confirmedDeleted: confirmedDoomed.length });
}
