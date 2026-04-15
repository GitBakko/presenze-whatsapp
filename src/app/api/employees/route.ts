import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const url = new URL(request.url);
  if (url.searchParams.get("withoutPayrollId") === "1") {
    const list = await prisma.employee.findMany({
      where: { payrollId: null },
      select: { id: true, name: true, displayName: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(list);
  }

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
      telegramChatId: emp.telegramChatId,
      telegramUsername: emp.telegramUsername,
      email: emp.email,
      totalDays,
      lastSeen: emp.records[0]?.date || null,
    };
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  let body: {
    name?: unknown;
    displayName?: unknown;
    hireDate?: unknown;
    contractType?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Il campo 'name' è obbligatorio" }, { status: 400 });
  }

  const displayName =
    typeof body.displayName === "string" && body.displayName.trim() !== ""
      ? body.displayName.trim()
      : null;

  let hireDate: Date | null = null;
  if (typeof body.hireDate === "string" && body.hireDate.trim() !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.hireDate)) {
      return NextResponse.json(
        { error: "Formato hireDate non valido (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    hireDate = new Date(body.hireDate);
  }

  const contractType =
    typeof body.contractType === "string" && ["FULL_TIME", "PART_TIME"].includes(body.contractType)
      ? body.contractType
      : "FULL_TIME";

  try {
    const created = await prisma.employee.create({
      data: { name, displayName, hireDate, contractType },
    });
    return NextResponse.json(
      {
        id: created.id,
        name: created.name,
        displayName: created.displayName,
        hireDate: created.hireDate?.toISOString().split("T")[0] ?? null,
        contractType: created.contractType,
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Esiste già un dipendente con questo nome" },
        { status: 409 }
      );
    }
    throw e;
  }
}
