import { NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const item = await prisma.payrollImport.findUnique({
    where: { id },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!item) return NextResponse.json({ error: "Import non trovato" }, { status: 404 });

  return NextResponse.json({
    id: item.id,
    createdAt: item.createdAt.toISOString(),
    userName: item.user.name,
    userEmail: item.user.email,
    fileName: item.fileName,
    fileHash: item.fileHash,
    year: item.year,
    sourceMonth: item.sourceMonth,
    totalEmployees: item.totalEmployees,
    matchedEmployees: item.matchedEmployees,
    orphanEmployees: item.orphanEmployees,
    payload: JSON.parse(item.payload),
  });
}
