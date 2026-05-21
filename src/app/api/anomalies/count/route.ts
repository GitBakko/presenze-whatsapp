import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { todayRome } from "@/lib/tz";

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const today = todayRome();
  const count = await prisma.anomaly.count({
    where: { resolved: false, date: { lt: today } },
  });

  return NextResponse.json({ count });
}
