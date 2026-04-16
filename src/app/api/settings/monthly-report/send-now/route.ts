import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { triggerMonthlyReportNow } from "@/lib/monthly-report-worker";

export async function POST() {
  const denied = await checkAuth();
  if (denied) return denied;

  try {
    const sentTo = await triggerMonthlyReportNow();
    return NextResponse.json({ ok: true, sentTo });
  } catch (err) {
    console.error("[monthly-report/send-now]", err);
    const msg = err instanceof Error ? err.message : "Errore invio report";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
