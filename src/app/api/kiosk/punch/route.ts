import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validateApiKey } from "@/lib/api-key-auth";
import { todayRome, nowRomeHHMM, dowRome } from "@/lib/tz";
import { decideAction } from "@/lib/kiosk-classifier";
import { calculateDailyStats, type DailyRecord, type EmployeeScheduleDay } from "@/lib/calculator";
import { syncAnomalies } from "@/lib/anomaly-sync";

/**
 * Endpoint chiamato dal servizio Windows del kiosk NFC ad ogni tap.
 *
 * Auth: Bearer ApiKey (stesso pattern di /api/external/leaves).
 * Body: { uid: string }   — UID hex della tessera (CIE/CNS/Mifare)
 *
 * Flusso:
 *   1. valida API key
 *   2. normalizza UID (uppercase, solo hex)
 *   3. cerca dipendente per nfcUid
 *      - se non trovato → upsert in UnrecognizedNfc → 404 unknown_uid
 *   4. debounce server: rifiuta se ultimo record dell'employee è < 10s fa
 *   5. classifica: ENTRY | EXIT | PAUSE_START | PAUSE_END
 *   6. inserisce AttendanceRecord (source="NFC", isManual=false)
 *      - su P2002 (duplicato esatto) → 409 duplicate
 *   7. ricalcola anomalie per (employeeId, date)
 *   8. risponde { status:"ok", action, employeeName, time, recordId }
 */

const DEBOUNCE_SECONDS = 10;

function normalizeUid(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

export async function POST(request: NextRequest) {
  const isValid = await validateApiKey(request);
  if (!isValid) {
    return NextResponse.json({ status: "unauthorized", error: "API key non valida" }, { status: 401 });
  }

  let body: { uid?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "bad_request", error: "Body JSON non valido" }, { status: 400 });
  }

  const rawUid = typeof body.uid === "string" ? body.uid : "";
  const uid = normalizeUid(rawUid);
  if (!uid) {
    return NextResponse.json({ status: "bad_request", error: "Campo 'uid' obbligatorio" }, { status: 400 });
  }

  // 1. Risolvi dipendente
  const employee = await prisma.employee.findUnique({ where: { nfcUid: uid } });

  if (!employee) {
    // Upsert UnrecognizedNfc per review admin
    await prisma.unrecognizedNfc.upsert({
      where: { uid },
      create: { uid },
      update: {
        lastSeenAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    return NextResponse.json(
      { status: "unknown_uid", uid, error: "Tessera non associata a nessun dipendente" },
      { status: 404 }
    );
  }

  const now = new Date();
  const date = todayRome(now);
  const declaredTime = nowRomeHHMM(now);

  // 2. Debounce server: rifiuta tap consecutivi entro DEBOUNCE_SECONDS
  const debounceCutoff = new Date(now.getTime() - DEBOUNCE_SECONDS * 1000);
  const recent = await prisma.attendanceRecord.findFirst({
    where: {
      employeeId: employee.id,
      date,
      createdAt: { gt: debounceCutoff },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    return NextResponse.json(
      {
        status: "too_soon",
        error: "Tap troppo ravvicinato",
        debounceSeconds: DEBOUNCE_SECONDS,
        employeeName: employee.displayName || employee.name,
      },
      { status: 429 }
    );
  }

  // 3. Carica ultimo record del giorno per determinare lo stato
  const lastRecord = await prisma.attendanceRecord.findFirst({
    where: { employeeId: employee.id, date },
    orderBy: [{ declaredTime: "desc" }, { createdAt: "desc" }],
    select: { type: true },
  });

  // 4. Carica schedule del giorno (può essere null → fallback ai defaults)
  const dayOfWeek = dowRome(now);
  const schedule = await prisma.employeeSchedule.findUnique({
    where: { employeeId_dayOfWeek: { employeeId: employee.id, dayOfWeek } },
  });

  // 5. Classifica
  const action = decideAction({
    last: lastRecord,
    now: declaredTime,
    schedule,
  });

  // 6. Inserisci il record
  let recordId: string;
  try {
    const created = await prisma.attendanceRecord.create({
      data: {
        employeeId: employee.id,
        date,
        type: action,
        declaredTime,
        messageTime: declaredTime,
        rawMessage: `[NFC] UID:${uid} → ${employee.displayName || employee.name}`,
        source: "NFC",
        isManual: false,
      },
    });
    recordId = created.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        {
          status: "duplicate",
          error: "Record già presente per questo orario",
          employeeName: employee.displayName || employee.name,
          action,
          time: declaredTime,
        },
        { status: 409 }
      );
    }
    throw e;
  }

  // 7. Ricalcola anomalie per questa coppia (employeeId, date) — fire & forget non
  //    blocca la risposta in caso di errore: lo logga soltanto.
  try {
    const dayRecords = await prisma.attendanceRecord.findMany({
      where: { employeeId: employee.id, date },
      orderBy: { declaredTime: "asc" },
    });
    const dr: DailyRecord = {
      employeeId: employee.id,
      employeeName: employee.displayName || employee.name,
      date,
      records: dayRecords.map((r) => ({
        type: r.type as DailyRecord["records"][0]["type"],
        declaredTime: r.declaredTime,
        messageTime: r.messageTime,
      })),
    };
    const empScheduleDay: EmployeeScheduleDay | null = schedule
      ? {
          block1Start: schedule.block1Start,
          block1End: schedule.block1End,
          block2Start: schedule.block2Start,
          block2End: schedule.block2End,
        }
      : null;
    const stats = calculateDailyStats(dr, empScheduleDay);
    await syncAnomalies([stats]);
  } catch (err) {
    console.error("[kiosk/punch] syncAnomalies failed:", err);
  }

  // 8. Risposta
  return NextResponse.json(
    {
      status: "ok",
      action, // ENTRY | EXIT | PAUSE_START | PAUSE_END
      employeeName: employee.displayName || employee.name,
      time: declaredTime,
      date,
      recordId,
    },
    { status: 201 }
  );
}
