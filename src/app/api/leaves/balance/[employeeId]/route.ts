import { NextRequest, NextResponse } from "next/server";
import { checkAuthAny, isAuthUser, resolveEmployeeId } from "@/lib/auth-guard";
import { computeLeaveBalance } from "@/lib/leaves";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> }
) {
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;

  const { employeeId } = await params;

  // Employee può vedere solo il proprio saldo
  if (authResult.role === "EMPLOYEE") {
    const ownEmpId = await resolveEmployeeId(authResult);
    if (ownEmpId !== employeeId) {
      return NextResponse.json({ error: "Accesso non autorizzato" }, { status: 403 });
    }
  }
  const year = new Date().getFullYear();

  try {
    const balance = await computeLeaveBalance(employeeId, year);
    return NextResponse.json({ year, ...balance });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Errore";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
