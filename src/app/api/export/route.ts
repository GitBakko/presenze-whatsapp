import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateDailyStats, type DailyRecord, type EmployeeScheduleDay } from "@/lib/calculator";
import { hoursToHHMM, minutesToHHMM } from "@/lib/formatTime";
import * as XLSX from "xlsx";
import { checkAuth } from "@/lib/auth-guard";
import { LEAVE_TYPES, type LeaveType } from "@/lib/leaves";

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const format = searchParams.get("format") || "csv";
  const includeLeaves = searchParams.get("includeLeaves") === "true";

  if (!from || !to) {
    return NextResponse.json(
      { error: "Parametri 'from' e 'to' richiesti" },
      { status: 400 }
    );
  }

  const records = await prisma.attendanceRecord.findMany({
    where: { date: { gte: from, lte: to } },
    include: { employee: true },
    orderBy: [{ date: "asc" }, { declaredTime: "asc" }],
  });

  // Load schedules
  const schedules = await prisma.employeeSchedule.findMany();
  const scheduleMap = new Map<string, Map<number, EmployeeScheduleDay>>();
  for (const s of schedules) {
    if (!scheduleMap.has(s.employeeId)) scheduleMap.set(s.employeeId, new Map());
    scheduleMap.get(s.employeeId)!.set(s.dayOfWeek, {
      block1Start: s.block1Start,
      block1End: s.block1End,
      block2Start: s.block2Start,
      block2End: s.block2End,
    });
  }

  // Group by employee+date
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

  const dismissed = await prisma.anomaly.findMany({
    where: { resolved: true },
    select: { employeeId: true, date: true, type: true, description: true },
  });
  const dismissedSet = new Set(
    dismissed.map((d) => `${d.employeeId}|${d.date}|${d.type}|${d.description}`)
  );

  const dailyStats = Array.from(grouped.values()).map((dr) => {
    const dayOfWeek = getDayOfWeek(dr.date);
    const empSchedule = scheduleMap.get(dr.employeeId)?.get(dayOfWeek) ?? null;
    const s = calculateDailyStats(dr, empSchedule);
    s.anomalies = s.anomalies.filter(
      (a) => !dismissedSet.has(`${s.employeeId}|${s.date}|${a.type}|${a.description}`)
    );
    s.hasAnomaly = s.anomalies.length > 0;
    return s;
  });

  // Load approved leaves for the period if requested
  const leaveMap = new Map<string, string>(); // "employeeId|date" -> typeLabel
  if (includeLeaves && from && to) {
    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: to },
        endDate: { gte: from },
      },
    });
    for (const l of leaves) {
      const start = l.startDate < from ? from : l.startDate;
      const end = l.endDate > to ? to : l.endDate;
      const cur = new Date(start);
      const endDate = new Date(end);
      while (cur <= endDate) {
        const dateStr = cur.toISOString().split("T")[0];
        const key = `${l.employeeId}|${dateStr}`;
        leaveMap.set(key, LEAVE_TYPES[l.type as LeaveType]?.label ?? l.type);
        cur.setDate(cur.getDate() + 1);
      }
    }
  }

  // Prepare rows for export.
  //
  // Colonne entrate/uscite: la vecchia versione ("Entrate" = join di tutte
  // le entries, "Uscite" = join di tutte le exits) era illeggibile quando
  // il dipendente aveva piu' coppie nella stessa giornata. Adesso
  // splittiamo in 4 colonne distinte:
  //   Mattina Entrata  = entries[0]
  //   Mattina Uscita   = exits[0]
  //   Pomeriggio Entrata = entries[1]
  //   Pomeriggio Uscita  = exits[1]
  //
  // Eventuali entrate/uscite oltre la seconda coppia (caso raro / anomalia)
  // non vengono mostrate in queste colonne: l'eventuale anomalia di mismatch
  // apparira' comunque nella colonna "Anomalia".
  const rows = dailyStats.map((s) => {
    const base: Record<string, string> = {
      Dipendente: s.employeeName,
      Data: s.date,
      "Mattina Entrata": s.entries[0] ?? "",
      "Mattina Uscita": s.exits[0] ?? "",
      "Pomeriggio Entrata": s.entries[1] ?? "",
      "Pomeriggio Uscita": s.exits[1] ?? "",
      "Ore Lavorate": hoursToHHMM(s.hoursWorked),
      "Ore (timestamp)": hoursToHHMM(s.hoursWorkedMsg),
      "Pausa": s.pauseMinutes > 0 ? minutesToHHMM(s.pauseMinutes) : "-",
      "Ritardo Mattina": s.morningDelay > 0 ? minutesToHHMM(s.morningDelay) : "-",
      "Ritardo Pomeriggio": s.afternoonDelay > 0 ? minutesToHHMM(s.afternoonDelay) : "-",
      "Straordinario": s.overtime > 0 ? hoursToHHMM(s.overtime) : "-",
      Anomalia: s.anomalies.map((a) => a.description).join("; ") || "-",
    };
    if (includeLeaves) {
      base["Assenza"] = leaveMap.get(`${s.employeeId}|${s.date}`) ?? "-";
    }
    return base;
  });

  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Presenze");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="presenze_${from}_${to}.xlsx"`,
      },
    });
  }

  // CSV
  if (rows.length === 0) {
    return new NextResponse("Nessun dato trovato", {
      headers: { "Content-Type": "text/plain" },
    });
  }

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const val = String(r[h as keyof typeof r] ?? "");
          return val.includes(",") ? `"${val}"` : val;
        })
        .join(",")
    ),
  ];

  return new NextResponse(csvLines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="presenze_${from}_${to}.csv"`,
    },
  });
}

function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 7 : day;
}
