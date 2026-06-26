import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/leaves/[id]/confirm
 *
 * Admin confirms a predictor-generated leave day (decision D5/UI-rule 3): all
 * predictor days must eventually be confirmed; HR deletes the un-enjoyed ones.
 * Sets confirmedAt/confirmedById so the recompute no longer wipes/regenerates it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!leave) {
    return NextResponse.json({ error: "Richiesta non trovata" }, { status: 404 });
  }
  if (leave.source !== "PREDICTOR") {
    return NextResponse.json({ error: "Solo i giorni del predittore sono confermabili" }, { status: 400 });
  }

  const session = await auth();
  const updated = await prisma.leaveRequest.update({
    where: { id },
    data: { confirmedAt: new Date(), confirmedById: session?.user?.id ?? null },
  });
  return NextResponse.json(updated);
}
