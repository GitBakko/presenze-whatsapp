import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { computeMonteTrend, type MonteTrendEmployeeInput } from "@/lib/leaves/monte-trend";

/**
 * GET /api/leaves/monte-trend
 *
 * Admin-only. Month-by-month residual monte ferie/permessi (in days, ROL ore/8)
 * for the current year: one series per employee + a company total. Powers the
 * trend chart on the Ferie & permessi page and the dashboard widget.
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const now = new Date();
  const year = now.getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [employees, balances, leaves] = await Promise.all([
    prisma.employee.findMany({ include: { schedule: true }, orderBy: { name: "asc" } }),
    prisma.leaveBalance.findMany({ where: { year } }),
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { gte: yearStart, lte: yearEnd } },
    }),
  ]);

  // Drop employees who left before this year started — they would only flatline.
  const yearStartDate = new Date(year, 0, 1, 12, 0, 0);
  const active = employees.filter((e) => !e.terminationDate || new Date(e.terminationDate) >= yearStartDate);

  const balByEmp = new Map(balances.map((b) => [b.employeeId, b]));
  const leavesByEmp = new Map<string, typeof leaves>();
  for (const l of leaves) {
    const arr = leavesByEmp.get(l.employeeId) ?? [];
    arr.push(l);
    leavesByEmp.set(l.employeeId, arr);
  }

  const inputs: MonteTrendEmployeeInput[] = active.map((e) => ({
    id: e.id,
    name: e.displayName || e.name,
    employee: {
      id: e.id,
      hireDate: e.hireDate,
      terminationDate: e.terminationDate,
      contractType: e.contractType,
      schedule: e.schedule,
    },
    balance: balByEmp.get(e.id) ?? null,
    leaves: (leavesByEmp.get(e.id) ?? []).map((l) => ({
      type: l.type, startDate: l.startDate, endDate: l.endDate, hours: l.hours, timeSlots: l.timeSlots, source: l.source,
    })),
  }));

  return NextResponse.json(computeMonteTrend(inputs, year, now));
}
