import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuthAny, isAuthUser } from "@/lib/auth-guard";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";

export async function GET(request: NextRequest) {
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month"); // YYYY-MM
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Parametro 'month' obbligatorio (YYYY-MM)" }, { status: 400 });
    }

    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr);
    const mon = parseInt(monthStr);
    const daysInMonth = new Date(year, mon, 0).getDate();

    const from = `${month}-01`;
    const to = `${month}-${String(daysInMonth).padStart(2, "0")}`;

    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: { in: ["APPROVED", "PENDING"] },
        startDate: { lte: to },
        endDate: { gte: from },
      },
      include: { employee: true, approvedBy: true },
      orderBy: { startDate: "asc" },
    });

    const calendar: {
      date: string;
      events: {
        id: string;
        employeeId: string;
        employeeName: string;
        type: string;
        typeLabel: string;
        status: string;
        hours: number | null;
        startDate: string;
        endDate: string;
        timeSlots: { from: string; to: string }[] | null;
        notes: string | null;
        source: string;
        approvedBy: string | null;
        approvedAt: string | null;
        createdAt: string;
      }[];
    }[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, "0")}`;
      const events = leaves
        .filter((l) => l.startDate <= dateStr && l.endDate >= dateStr)
        .map((l) => ({
          id: l.id,
          employeeId: l.employeeId,
          employeeName: l.employee.displayName || l.employee.name,
          type: l.type,
          typeLabel: LEAVE_TYPES[l.type as LeaveType]?.label ?? l.type,
          status: l.status,
          hours: l.hours,
          startDate: l.startDate,
          endDate: l.endDate,
          timeSlots: l.timeSlots ? JSON.parse(l.timeSlots) as { from: string; to: string }[] : null,
          notes: l.notes,
          source: l.source,
          approvedBy: l.approvedBy?.name ?? null,
          approvedAt: l.approvedAt?.toISOString() ?? null,
          createdAt: l.createdAt.toISOString(),
        }));

      calendar.push({ date: dateStr, events });
    }

    return NextResponse.json({ month, calendar });
  } catch (err) {
    console.error("Calendar GET error:", err);
    const message = err instanceof Error ? err.message : "Errore nel caricamento calendario";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
