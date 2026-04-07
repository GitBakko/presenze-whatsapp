import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

/**
 * Storico ingest email (ultime 100 voci, dalla piu' recente).
 * Usato dall'admin per audit/troubleshooting.
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const items = await prisma.emailIngestLog.findMany({
    orderBy: { processedAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    items.map((i) => ({
      id: i.id,
      messageId: i.messageId,
      fromAddress: i.fromAddress,
      subject: i.subject,
      status: i.status,
      errorDetail: i.errorDetail,
      leaveRequestId: i.leaveRequestId,
      processedAt: i.processedAt.toISOString(),
    }))
  );
}
