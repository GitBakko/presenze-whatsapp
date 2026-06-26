import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { computeLeaveBalance } from "@/lib/leaves";
import { projectYearEndResidual } from "@/lib/leaves/balance";
import { computePool } from "@/lib/leaves/amortization";
import { CONTRACT_DAILY_HOURS } from "@/lib/employees/schedule-fallback";

/**
 * GET /api/leaves/predictor/plan
 *
 * Admin-only. Returns the current amortization plan per predictor-enabled
 * employee: residual, unified hour-pool, and the predictor leave days (with
 * confirmation state) for the Piano ammortamento page.
 *
 * Note: residuals are PROJECTED to year-end (current remaining — already net of
 * the predictor days — plus the 2 ferie + 4 ROL h/month still to accrue), so
 * `pool.totalDays` reflects what a fresh recompute would still distribute
 * (≈ 0 right after a recompute).
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const employees = await prisma.employee.findMany({
    where: { leavePredictorEnabled: true, terminationDate: null },
    include: { schedule: true },
    orderBy: { name: "asc" },
  });

  const result = [];
  for (const e of employees) {
    let balance;
    try {
      balance = await computeLeaveBalance(e.id, year);
    } catch {
      continue; // skip employees whose balance can't be computed
    }
    const dailyH = CONTRACT_DAILY_HOURS[e.contractType] ?? CONTRACT_DAILY_HOURS.FULL_TIME;
    // Project the residual to year-end (current + future monthly accrual) so the
    // displayed pool matches what a recompute amortises (the predictor zeroes the
    // PROJECTED 31/12 monte, not just today's residual).
    const projected = projectYearEndResidual(
      balance.vacationRemaining, balance.rolRemaining, balance.weeklyHours, new Date(), year, e.terminationDate,
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
    const days = await prisma.leaveRequest.findMany({
      where: { employeeId: e.id, source: "PREDICTOR", startDate: { gte: yearStart, lte: yearEnd } },
      orderBy: { startDate: "asc" },
      select: { id: true, startDate: true, type: true, hours: true, confirmedAt: true },
    });

    result.push({
      employeeId: e.id,
      name: e.displayName || e.name,
      avatarUrl: e.avatarUrl,
      vacationRemaining: projected.vacationRemaining,
      rolRemaining: projected.rolRemaining,
      dailyH,
      unifiedHours: Math.round((projected.vacationRemaining * dailyH + projected.rolRemaining) * 100) / 100,
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
    });
  }

  return NextResponse.json({ year, employees: result });
}
