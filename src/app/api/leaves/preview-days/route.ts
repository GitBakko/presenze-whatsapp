import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuthAny, isAuthUser, resolveEmployeeId } from "@/lib/auth-guard";
import { expandToWorkingDays } from "@/lib/leaves/working-days";
import { isPublicHoliday } from "@/lib/leaves/holidays";
import { buildWorkingScheduleMap } from "@/lib/employees/schedule-fallback";

export async function POST(request: NextRequest) {
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;

  const body = await request.json();
  let { employeeId } = body as { employeeId?: string };
  const { startDate, endDate, type } = body as {
    startDate?: string;
    endDate?: string;
    type?: string;
  };

  if (authResult.role === "EMPLOYEE") {
    employeeId = (await resolveEmployeeId(authResult)) ?? undefined;
  }

  if (!employeeId || !startDate || !endDate || !type) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { schedule: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  // Working-day map keyed by the days actually worked: empty rows (no work block)
  // are excluded so a stray weekend row can't make Sat/Sun count, and schedule-less
  // FULL_TIME falls back to Mon-Fri. Shared rule (schedule-fallback.ts) with
  // balance.ts ed excel-presenze.ts.
  const scheduleMap = buildWorkingScheduleMap(employee.schedule, employee.contractType);

  if (type === "VACATION_HALF_AM" || type === "VACATION_HALF_PM") {
    return NextResponse.json({
      effectiveDays: 0.5,
      breakdown: [{ date: startDate, working: true }],
    });
  }
  if (["ROL", "BEREAVEMENT", "MARRIAGE", "LAW_104", "MEDICAL_VISIT"].includes(type)) {
    return NextResponse.json({
      effectiveDays: null,
      hoursMode: true,
    });
  }

  const workingDays = expandToWorkingDays(startDate, endDate, scheduleMap);
  const effectiveDays = workingDays.length;

  const breakdown: Array<{ date: string; working: boolean; reason?: string }> = [];
  const dowMap: Record<number, string> = {
    0: "Domenica",
    1: "Lunedì",
    2: "Martedì",
    3: "Mercoledì",
    4: "Giovedì",
    5: "Venerdì",
    6: "Sabato",
  };
  let cur = startDate;
  while (cur <= endDate) {
    const [y, m, d] = cur.split("-").map(Number);
    const jsDow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
    const dowIso = jsDow === 0 ? 7 : jsDow;
    let reason: string | undefined;
    let working = scheduleMap.has(dowIso);
    if (working && isPublicHoliday(cur)) {
      working = false;
      reason = "Festività";
    } else if (!working) {
      reason = dowMap[jsDow];
    }
    breakdown.push({ date: cur, working, reason });

    const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    t.setUTCDate(t.getUTCDate() + 1);
    cur = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  }

  return NextResponse.json({ effectiveDays, breakdown });
}
