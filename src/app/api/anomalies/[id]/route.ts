import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

interface ResolveAction {
  /** "add" = create a missing record, "delete" = remove an extra record */
  kind: "add" | "delete";
  /** For "add": the record type (ENTRY, EXIT, PAUSE_END, OVERTIME_END) */
  type?: string;
  /** For "add": the time HH:MM */
  declaredTime?: string;
  /** For "delete": the record ID to remove */
  recordId?: string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();

  const { resolved, resolution, actions } = body as {
    resolved: boolean;
    resolution?: string;
    actions?: ResolveAction[];
  };

  // Fetch anomaly first to get employee/date context
  const anomaly = await prisma.anomaly.findUnique({ where: { id } });
  if (!anomaly) {
    return NextResponse.json({ error: "Anomalia non trovata" }, { status: 404 });
  }

  // Validate actions
  const VALID_TYPES = ["ENTRY", "EXIT", "PAUSE_START", "PAUSE_END", "OVERTIME_START", "OVERTIME_END"];
  const timeRegex = /^\d{2}:\d{2}$/;

  if (actions) {
    if (!Array.isArray(actions) || actions.length > 20) {
      return NextResponse.json({ error: "Massimo 20 azioni correttive" }, { status: 400 });
    }
    for (const action of actions) {
      if (action.kind !== "add" && action.kind !== "delete") {
        return NextResponse.json({ error: "Tipo azione non valido (add/delete)" }, { status: 400 });
      }
      if (action.kind === "add") {
        if (!action.type || !VALID_TYPES.includes(action.type)) {
          return NextResponse.json({ error: `Tipo record non valido. Valori ammessi: ${VALID_TYPES.join(", ")}` }, { status: 400 });
        }
        if (!action.declaredTime || !timeRegex.test(action.declaredTime)) {
          return NextResponse.json({ error: "Formato orario non valido (HH:MM)" }, { status: 400 });
        }
      }
      if (action.kind === "delete") {
        if (!action.recordId) {
          return NextResponse.json({ error: "recordId richiesto per azione delete" }, { status: 400 });
        }
        // Verify record belongs to the same employee/date as the anomaly
        const record = await prisma.attendanceRecord.findUnique({ where: { id: action.recordId } });
        if (!record || record.employeeId !== anomaly.employeeId || record.date !== anomaly.date) {
          return NextResponse.json({ error: "Record non trovato o non appartenente a questa anomalia" }, { status: 400 });
        }
      }
    }
  }

  // Execute corrective actions inside a transaction
  await prisma.$transaction(async (tx) => {
    if (actions && actions.length > 0) {
      for (const action of actions) {
        if (action.kind === "add" && action.type && action.declaredTime) {
          await tx.attendanceRecord.create({
            data: {
              employeeId: anomaly.employeeId,
              date: anomaly.date,
              type: action.type,
              declaredTime: action.declaredTime,
              messageTime: action.declaredTime,
              rawMessage: `[Risoluzione anomalia] ${action.type} ${action.declaredTime}`,
              source: "MANUAL",
              isManual: true,
            },
          });
        } else if (action.kind === "delete" && action.recordId) {
          await tx.attendanceRecord.delete({
            where: { id: action.recordId },
          });
        }
      }
    }

    // Mark anomaly as resolved
    await tx.anomaly.update({
      where: { id },
      data: {
        resolved,
        resolution: resolution ?? null,
        resolvedAt: resolved ? new Date() : null,
      },
    });
  });

  // Return updated anomaly
  const updated = await prisma.anomaly.findUnique({
    where: { id },
    include: { employee: true, resolvedBy: true },
  });

  return NextResponse.json({
    id: updated!.id,
    employee: updated!.employee.displayName || updated!.employee.name,
    employeeId: updated!.employeeId,
    date: updated!.date,
    type: updated!.type,
    description: updated!.description,
    resolved: updated!.resolved,
    resolvedAt: updated!.resolvedAt?.toISOString() ?? null,
    resolvedBy: updated!.resolvedBy?.name ?? null,
    resolution: updated!.resolution,
  });
}

/**
 * GET /api/anomalies/:id/records — fetch records for this anomaly's employee+date
 * Used by the resolution UI to show existing records for deletion
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const anomaly = await prisma.anomaly.findUnique({ where: { id } });
  if (!anomaly) {
    return NextResponse.json({ error: "Anomalia non trovata" }, { status: 404 });
  }

  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId: anomaly.employeeId, date: anomaly.date },
    orderBy: { declaredTime: "asc" },
  });

  return NextResponse.json(
    records.map((r) => ({
      id: r.id,
      type: r.type,
      declaredTime: r.declaredTime,
      messageTime: r.messageTime,
      source: r.source,
      isManual: r.isManual,
    }))
  );
}
