import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

/**
 * POST /api/anomalies/dismiss
 * Create-and-resolve an anomaly in one step (for calculated anomalies
 * that don't exist in DB yet). If an anomaly with the same
 * (employeeId, date, type, description) already exists, toggle its resolved flag.
 */
export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { employeeId, date, type, description } = body as {
    employeeId: string;
    date: string;
    type: string;
    description: string;
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

  // Create new anomaly already resolved
  const anomaly = await prisma.anomaly.create({
    data: {
      employeeId,
      date,
      type,
      description,
      resolved: true,
      resolvedAt: new Date(),
      resolution: "Segnato come corretto",
    },
  });

  return NextResponse.json({ id: anomaly.id, resolved: true });
}
