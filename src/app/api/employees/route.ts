import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;
  const employees = await prisma.employee.findMany({
    include: {
      records: {
        orderBy: { date: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });

  const result = employees.map((emp) => {
    const dates = new Set(emp.records.map((r) => r.date));
    const totalDays = dates.size;
    return {
      id: emp.id,
      name: emp.name,
      displayName: emp.displayName,
      avatarUrl: emp.avatarUrl,
      aliases: JSON.parse(emp.aliases) as string[],
      nfcUid: emp.nfcUid,
      totalDays,
      lastSeen: emp.records[0]?.date || null,
    };
  });

  return NextResponse.json(result);
}
