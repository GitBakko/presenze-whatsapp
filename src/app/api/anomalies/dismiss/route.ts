import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

/**
 * POST /api/anomalies/dismiss
 * Create-or-find a persisted anomaly from a computed one.
 *
 * Behaviour:
 *  - If the anomaly already exists (same employeeId+date+type+description):
 *      - default: toggle the `resolved` flag (used by "Corretto" button)
 *      - if `persistOnly: true` was passed: do nothing, just return the id
 *  - If it doesn't exist:
 *      - default: create it already resolved
 *      - if `persistOnly: true`: create it as unresolved, so the caller can
 *        then open the standard "Risolvi" modal on a real DB id
 */
export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { employeeId, date, type, description, persistOnly } = body as {
    employeeId: string;
    date: string;
    type: string;
    description: string;
    persistOnly?: boolean;
  };

  if (!employeeId || !date || !type || !description) {
    return NextResponse.json(
      { error: "Parametri mancanti (employeeId, date, type, description)" },
      { status: 400 }
    );
  }

  // Date format validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Formato data non valido (YYYY-MM-DD)" }, { status: 400 });
  }

  // Check employee exists
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  // Find existing anomaly with same fingerprint
  const existing = await prisma.anomaly.findFirst({
    where: { employeeId, date, type, description },
  });

  if (existing) {
    if (persistOnly) {
      // Just return the id without altering state — used to open the
      // Risolvi modal on a real DB row.
      return NextResponse.json({ id: existing.id, resolved: existing.resolved });
    }
    // Toggle resolved state
    const updated = await prisma.anomaly.update({
      where: { id: existing.id },
      data: {
        resolved: !existing.resolved,
        resolvedAt: !existing.resolved ? new Date() : null,
        resolution: !existing.resolved ? "Segnato come corretto" : null,
      },
    });
    return NextResponse.json({ id: updated.id, resolved: updated.resolved });
  }

  // Create new anomaly: resolved (dismiss) or unresolved (persistOnly)
  const anomaly = await prisma.anomaly.create({
    data: {
      employeeId,
      date,
      type,
      description,
      resolved: !persistOnly,
      resolvedAt: !persistOnly ? new Date() : null,
      resolution: !persistOnly ? "Segnato come corretto" : null,
    },
  });

  return NextResponse.json({ id: anomaly.id, resolved: !persistOnly });
}
