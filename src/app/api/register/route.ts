import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, name, password, systemPassword } = body;

  if (!email || !name || !password || !systemPassword) {
    return NextResponse.json(
      { error: "Tutti i campi sono obbligatori" },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Formato email non valido" },
      { status: 400 }
    );
  }

  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "La password deve contenere almeno 8 caratteri" },
      { status: 400 }
    );
  }

  // Verify system registration secret
  if (systemPassword !== process.env.SYSTEM_REGISTRATION_SECRET) {
    return NextResponse.json(
      { error: "Password di sistema non valida" },
      { status: 403 }
    );
  }

  // Check if user already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Un utente con questa email esiste già" },
      { status: 409 }
    );
  }

  const passwordHash = await hash(password, 12);

  const user = await prisma.user.create({
    data: { email, name, passwordHash },
  });

  return NextResponse.json(
    { id: user.id, email: user.email, name: user.name },
    { status: 201 }
  );
}
