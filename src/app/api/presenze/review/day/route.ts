// src/app/api/presenze/review/day/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { notificationsBus } from "@/lib/notifications-bus";
import { recomputeAnomaliesForDates } from "@/lib/attendance/recompute";
import { planDayBatch, type SubmittedRecord } from "@/lib/attendance/review-day";

const VALID_TYPES = ["ENTRY", "EXIT", "PAUSE_START", "PAUSE_END", "OVERTIME_START", "OVERTIME_END"];

export async function PUT(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const session = await auth();
  const editorId = session?.user?.id ?? null;

  const body = await request.json();
  const { employeeId, date, records, reason } = body as {
    employeeId: string;
    date: string;
    records: SubmittedRecord[];
    reason?: string;
  };

  if (!employeeId || !date || !Array.isArray(records)) {
    return NextResponse.json({ error: "Campi obbligatori: employeeId, date, records[]" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }
  for (const r of records) {
    if (!VALID_TYPES.includes(r.type)) {
      return NextResponse.json({ error: `Tipo non valido: ${r.type}` }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(r.declaredTime)) {
      return NextResponse.json({ error: `Orario non valido: ${r.declaredTime}` }, { status: 400 });
    }
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  const existingRows = await prisma.attendanceRecord.findMany({
    where: { employeeId, date },
    orderBy: [{ declaredTime: "asc" }],
  });
  const plan = planDayBatch(
    existingRows.map((r) => ({ id: r.id, type: r.type, declaredTime: r.declaredTime })),
    records,
  );

  if (plan.unknownIds.length > 0) {
    return NextResponse.json(
      { error: `Record non trovati (stato non aggiornato): ${plan.unknownIds.join(", ")}` },
      { status: 409 },
    );
  }
  if (plan.collision) {
    return NextResponse.json(
      { error: "Due registrazioni hanno lo stesso tipo e orario nello stesso giorno" },
      { status: 409 },
    );
  }

  const existingById = new Map(existingRows.map((r) => [r.id, r]));

  try {
    await prisma.$transaction(async (tx) => {
      for (const id of plan.toDelete) {
        const cur = existingById.get(id)!;
        await tx.attendanceRecord.delete({ where: { id } });
        if (editorId) {
          await tx.attendanceRecordEdit.create({
            data: {
              recordId: null, employeeId, date, editedById: editorId, action: "DELETE",
              oldType: cur.type, oldDeclaredTime: cur.declaredTime, oldDate: date,
              reason: reason ?? null, source: "REVIEW",
              changedFields: JSON.stringify(["type", "declaredTime", "date"]),
            },
          });
        }
      }
      for (const u of plan.toUpdate) {
        const cur = existingById.get(u.id)!;
        await tx.attendanceRecord.update({
          where: { id: u.id },
          data: { type: u.type, declaredTime: u.declaredTime },
        });
        if (editorId) {
          await tx.attendanceRecordEdit.create({
            data: {
              recordId: u.id, employeeId, date, editedById: editorId, action: "UPDATE",
              oldType: cur.type, oldDeclaredTime: cur.declaredTime, oldDate: date,
              newType: u.type, newDeclaredTime: u.declaredTime, newDate: date,
              reason: reason ?? null, source: "REVIEW",
              changedFields: JSON.stringify(
                [cur.type !== u.type ? "type" : null, cur.declaredTime !== u.declaredTime ? "declaredTime" : null].filter(Boolean),
              ),
            },
          });
        }
      }
      for (const c of plan.toCreate) {
        const created = await tx.attendanceRecord.create({
          data: {
            employeeId, date, type: c.type, declaredTime: c.declaredTime,
            messageTime: c.declaredTime,
            rawMessage: `[Revisione presenze] ${c.type} ${c.declaredTime}`,
            source: "MANUAL", isManual: true,
          },
        });
        if (editorId) {
          await tx.attendanceRecordEdit.create({
            data: {
              recordId: created.id, employeeId, date, editedById: editorId, action: "CREATE",
              newType: c.type, newDeclaredTime: c.declaredTime, newDate: date,
              reason: reason ?? null, source: "REVIEW",
              changedFields: JSON.stringify(["type", "declaredTime", "date"]),
            },
          });
        }
      }
    });
  } catch (err) {
    // Unique-constraint races inside the tx land here.
    const msg = String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "Conflitto: esiste già una registrazione con lo stesso tipo e orario" },
        { status: 409 },
      );
    }
    console.error("[review/day] transaction failed:", err);
    return NextResponse.json({ error: "Salvataggio non riuscito" }, { status: 500 });
  }

  // ONE recompute for the day (closes POST/DELETE gap; batch never N-fires).
  try {
    await recomputeAnomaliesForDates(employeeId, employee.displayName || employee.name, [date]);
  } catch (err) {
    console.error("[review/day] anomaly sync failed:", err);
  }

  try {
    notificationsBus.publish({
      employeeId,
      employeeName: employee.displayName || employee.name,
      action: "RECORD_UPDATED",
      time: "",
      date,
      details: { recordType: "BATCH" },
    });
  } catch (err) {
    console.error("[review/day] bus publish failed:", err);
  }

  return NextResponse.json({ ok: true, created: plan.toCreate.length, updated: plan.toUpdate.length, deleted: plan.toDelete.length });
}
