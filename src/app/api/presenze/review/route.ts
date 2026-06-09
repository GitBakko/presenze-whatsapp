// src/app/api/presenze/review/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { buildPresenzeMonthData } from "@/lib/excel-presenze";
import { flattenIssues, type ReviewEmployee } from "@/lib/presenze/issues";

function prevMonth(now: Date): { year: number; month: number } {
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return { year, month };
}

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month");
  let year: number, month: number;
  if (monthParam) {
    if (!/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: "Formato month non valido (YYYY-MM)" }, { status: 400 });
    }
    [year, month] = monthParam.split("-").map(Number);
  } else {
    ({ year, month } = prevMonth(new Date()));
  }
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;

  const [data, daySetting, enabledSetting, lastSentSetting] = await Promise.all([
    buildPresenzeMonthData(year, month),
    prisma.appSetting.findUnique({ where: { key: "monthlyReportDay" } }),
    prisma.appSetting.findUnique({ where: { key: "monthlyReportEnabled" } }),
    prisma.appSetting.findUnique({ where: { key: "lastReportSent" } }),
  ]);

  // buildPresenzeMonthData now exposes the stable Employee.id on each row
  // (PresenzeEmployeeData.employeeId, added in Task 2) — used directly by the
  // day editor. No fragile display-name join.
  const nDays = new Date(year, month, 0).getDate();
  const employees: ReviewEmployee[] = data.employees.map((emp) => {
    const days = [];
    for (let d = 1; d <= nDays; d++) {
      const c = emp.classifications.get(d);
      if (c) days.push(c);
    }
    return {
      employeeId: emp.employeeId,
      name: emp.displayName,
      displayName: emp.displayName,
      days,
      overtimeTotal: emp.straordinari,
    };
  });

  const issues = flattenIssues(employees);

  return NextResponse.json({
    month: monthStr,
    reportDay: daySetting ? parseInt(daySetting.value, 10) : 5,
    reportEnabled: enabledSetting ? enabledSetting.value !== "false" : true,
    alreadySent: lastSentSetting?.value === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}` && monthStr === prevMonthStr(new Date()),
    employees,
    issues,
  });
}

function prevMonthStr(now: Date): string {
  const { year, month } = prevMonth(now);
  return `${year}-${String(month).padStart(2, "0")}`;
}
