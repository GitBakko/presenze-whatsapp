import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { computeLeaveBalance } from "@/lib/leaves";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { employeeId } = await params;
  const year = new Date().getFullYear();

  try {
    const balance = await computeLeaveBalance(employeeId, year);
    return NextResponse.json({ year, ...balance });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Errore";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
