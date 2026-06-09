import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { notificationsBus } from "@/lib/notifications-bus";
import { auth } from "@/lib/auth";
import { recomputeAnomaliesForDates, computeRecordDiff } from "@/lib/attendance/recompute";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();
  const { type, declaredTime, date } = body as {
    type?: string;
    declaredTime?: string;
    date?: string;
  };

  const VALID_TYPES = ["ENTRY", "EXIT", "PAUSE_START", "PAUSE_END", "OVERTIME_START", "OVERTIME_END"];
  if (type && !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `Tipo non valido. Valori ammessi: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  if (declaredTime && !/^\d{2}:\d{2}$/.test(declaredTime)) {
    return NextResponse.json({ error: "Formato orario non valido (HH:MM)" }, { status: 400 });
  }

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }

  // Load original to know old date and employeeId
  const original = await prisma.attendanceRecord.findUnique({
    where: { id },
    include: { employee: true },
  });
  if (!original) {
    return NextResponse.json({ error: "Timbratura non trovata" }, { status: 404 });
  }

  const newDate = date ?? original.date;
  const newType = type ?? original.type;
  const newTime = declaredTime ?? original.declaredTime;

  // Check unique constraint — block if another record with same (employeeId, date, type, time) exists
  if (newDate !== original.date || newType !== original.type || newTime !== original.declaredTime) {
    const conflict = await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: original.employeeId,
        date: newDate,
        type: newType,
        declaredTime: newTime,
        id: { not: id },
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: `Esiste già una timbratura ${newType} del ${newDate} alle ${newTime} per questo dipendente` },
        { status: 409 }
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (type) data.type = type;
  if (declaredTime) data.declaredTime = declaredTime;
  if (date) data.date = date;

  const record = await prisma.attendanceRecord.update({
    where: { id },
    data,
    include: { employee: true },
  });

  const session = await auth();
  const editorId = session?.user?.id ?? null;
  if (editorId) {
    const diff = computeRecordDiff(
      { type: original.type, declaredTime: original.declaredTime, date: original.date },
      { type: record.type, declaredTime: record.declaredTime, date: record.date },
    );
    if (diff.changedFields.length > 0) {
      try {
        await prisma.attendanceRecordEdit.create({
          data: {
            recordId: record.id,
            employeeId: record.employeeId,
            date: record.date,
            editedById: editorId,
            action: "UPDATE",
            oldType: original.type, oldDeclaredTime: original.declaredTime, oldDate: original.date,
            newType: record.type, newDeclaredTime: record.declaredTime, newDate: record.date,
            source: "RECORDS",
            changedFields: JSON.stringify(diff.changedFields),
          },
        });
      } catch (err) {
        console.error("[records/PUT] audit write failed:", err);
      }
    }
  }

  try {
    notificationsBus.publish({
      employeeId: record.employeeId,
      employeeName: record.employee.displayName || record.employee.name,
      action: "RECORD_UPDATED",
      time: record.declaredTime,
      date: record.date,
      details: { recordId: record.id, recordType: record.type },
    });
  } catch (err) {
    console.error("[records/PUT] bus publish failed:", err);
  }

  // Ricalcola anomalie per i giorni coinvolti (vecchia data + nuova data se diverse)
  const datesToSync =
    original.date === record.date ? [record.date] : [original.date, record.date];
  try {
    await recomputeAnomaliesForDates(
      original.employeeId,
      original.employee.displayName || original.employee.name,
      datesToSync,
    );
  } catch (err) {
    console.error("[records/PUT] anomaly sync failed:", err);
  }

  return NextResponse.json(record);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;

  const existing = await prisma.attendanceRecord.findUnique({
    where: { id },
    include: { employee: true },
  });

  await prisma.attendanceRecord.delete({ where: { id } });

  if (existing) {
    try {
      notificationsBus.publish({
        employeeId: existing.employeeId,
        employeeName: existing.employee.displayName || existing.employee.name,
        action: "RECORD_DELETED",
        time: existing.declaredTime,
        date: existing.date,
        details: { recordId: existing.id, recordType: existing.type },
      });
    } catch (err) {
      console.error("[records/DELETE] bus publish failed:", err);
    }

    const session = await auth();
    const editorId = session?.user?.id ?? null;
    if (editorId) {
      try {
        await prisma.attendanceRecordEdit.create({
          data: {
            recordId: null,
            employeeId: existing.employeeId,
            date: existing.date,
            editedById: editorId,
            action: "DELETE",
            oldType: existing.type, oldDeclaredTime: existing.declaredTime, oldDate: existing.date,
            source: "RECORDS",
            changedFields: JSON.stringify(["type", "declaredTime", "date"]),
          },
        });
      } catch (err) {
        console.error("[records/DELETE] audit write failed:", err);
      }
    }
    try {
      await recomputeAnomaliesForDates(
        existing.employeeId,
        existing.employee.displayName || existing.employee.name,
        [existing.date],
      );
    } catch (err) {
      console.error("[records/DELETE] anomaly sync failed:", err);
    }
  }

  return NextResponse.json({ deleted: true });
}
