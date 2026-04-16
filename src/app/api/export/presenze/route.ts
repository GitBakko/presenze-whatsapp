import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import {
  buildPresenzeMonthData,
  generatePresenzeXlsx,
  presenzeFilename,
} from "@/lib/excel-presenze";

/**
 * GET /api/export/presenze?month=YYYY-MM
 *
 * Genera il report mensile "foglio presenze" nel formato griglia
 * dipendenti × giorni (vedi PROMPT_CONTRACT_REPORT_PRESENZE_XLSX.md).
 *
 * Auth: checkAuth() — stesso pattern di /api/export.
 *
 * Logica mapping per cella (dipendente + giorno del mese):
 *
 *   weekend/festivo       → gestito dal generator (riga O = "-", F/P vuota)
 *   leave full-day        → O: vuota, F/P: 8
 *   leave half-day        → O: Math.round(hoursWorked), F/P: 4
 *   leave a ore (ROL/visita)→ O: Math.round(hoursWorked), F/P: Math.round(leaveHours)
 *   solo lavoro           → O: Math.round(hoursWorked), F/P: vuota
 *   assenza senza leave   → entrambe vuote
 *
 * Buoni pasto = conteggio giorni nel mese con hoursWorked >= 6
 * (calcolato solo sulle ore effettivamente lavorate, non sui leave).
 */

const MONTH_REGEX = /^(\d{4})-(\d{2})$/;

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month");

  if (!monthParam || !MONTH_REGEX.test(monthParam)) {
    return NextResponse.json(
      { error: "Parametro 'month' richiesto nel formato YYYY-MM" },
      { status: 400 }
    );
  }

  const [, yearStr, monthStr] = monthParam.match(MONTH_REGEX)!;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (month < 1 || month > 12) {
    return NextResponse.json({ error: "Mese non valido (1-12)" }, { status: 400 });
  }

  const data = await buildPresenzeMonthData(year, month);
  const buf = await generatePresenzeXlsx(data);

  return new NextResponse(buf as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${presenzeFilename(year, month)}"`,
    },
  });
}
