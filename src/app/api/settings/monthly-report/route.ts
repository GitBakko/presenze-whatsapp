import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const dayRow = await prisma.appSetting.findUnique({ where: { key: "monthlyReportDay" } });
  const enabledRow = await prisma.appSetting.findUnique({ where: { key: "monthlyReportEnabled" } });

  return NextResponse.json({
    day: dayRow ? parseInt(dayRow.value, 10) : 5,
    enabled: enabledRow ? enabledRow.value !== "false" : true,
  });
}

export async function PUT(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { day, enabled } = body as { day?: number; enabled?: boolean };

  if (day !== undefined) {
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      return NextResponse.json({ error: "Giorno non valido (1-28)" }, { status: 400 });
    }
    await prisma.appSetting.upsert({
      where: { key: "monthlyReportDay" },
      create: { key: "monthlyReportDay", value: String(day) },
      update: { value: String(day) },
    });
  }

  if (typeof enabled === "boolean") {
    await prisma.appSetting.upsert({
      where: { key: "monthlyReportEnabled" },
      create: { key: "monthlyReportEnabled", value: String(enabled) },
      update: { value: String(enabled) },
    });
  }

  return NextResponse.json({ ok: true });
}
