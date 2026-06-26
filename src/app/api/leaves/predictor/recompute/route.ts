import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { auth } from "@/lib/auth";
import { recomputeAmortization } from "@/lib/leaves/amortization-service";

/**
 * POST /api/leaves/predictor/recompute
 *
 * Admin-only manual trigger for the leave amortization plan recompute
 * ("Ricalcola" on the Piano ammortamento page). Same engine the payroll
 * import calls automatically.
 */
export async function POST() {
  const denied = await checkAuth();
  if (denied) return denied;

  const session = await auth();
  const year = new Date().getFullYear();
  const result = await recomputeAmortization(year, "MANUAL", session?.user?.id);
  return NextResponse.json(result);
}
