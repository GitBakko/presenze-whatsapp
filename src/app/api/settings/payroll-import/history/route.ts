import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const items = await prisma.payrollImport.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { name: true, email: true } } },
  });

  return NextResponse.json(
    items.map((i) => ({
      id: i.id,
      createdAt: i.createdAt.toISOString(),
      userName: i.user.name,
      userEmail: i.user.email,
      fileName: i.fileName,
      year: i.year,
      sourceMonth: i.sourceMonth,
      totalEmployees: i.totalEmployees,
      matchedEmployees: i.matchedEmployees,
      orphanEmployees: i.orphanEmployees,
    }))
  );
}
