import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/leaves/predictor/exclusions/[id]
 *
 * Admin-only. Removes a predictor exclusion (a vetoed day becomes plannable
 * again). No automatic recompute: the current plan stays valid — the admin can
 * hit "Ricalcola" to let the engine reuse the freed day.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const found = await prisma.leavePredictorExclusion.findUnique({ where: { id } });
  if (!found) {
    return NextResponse.json({ error: "Esclusione non trovata" }, { status: 404 });
  }
  await prisma.leavePredictorExclusion.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
