import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { constantTimeEquals } from "@/lib/crypto-utils";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const ALLOWED_DOMAINS = ["epartner.it"];

const RegisterSchema = z.object({
  email: z.string().email().max(200),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[\p{L}\p{N}\s'.-]+$/u, "name contains invalid characters"),
  password: z.string().min(8).max(128),
  systemPassword: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  // Rate limit by IP, 5 req / 15 min
  const ip = getClientIp(request);
  const rl = rateLimit({ key: `register:${ip}`, max: 5, windowMs: 15 * 60_000 });
  if (!rl.ok) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 400 }
    );
  }
  const { email, name, password, systemPassword } = parsed.data;

  // Admin path: systemPassword present and matches (constant-time)
  const expectedAdminSecret = process.env.SYSTEM_REGISTRATION_SECRET ?? "";
  const isAdminRegistration =
    !!systemPassword &&
    expectedAdminSecret.length > 0 &&
    constantTimeEquals(systemPassword, expectedAdminSecret);

  if (systemPassword && !isAdminRegistration) {
    return NextResponse.json({ error: "Password di sistema non valida" }, { status: 403 });
  }

  // Employee path: enforce allowed domain
  if (!isAdminRegistration) {
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (!ALLOWED_DOMAINS.includes(domain)) {
      return NextResponse.json(
        { error: `La registrazione è consentita solo per indirizzi @${ALLOWED_DOMAINS.join(", @")}` },
        { status: 403 }
      );
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  // Admin path: real 409 on duplicate (caller is already authenticated by secret)
  if (isAdminRegistration && existing) {
    return NextResponse.json({ error: "Un utente con questa email esiste già" }, { status: 409 });
  }

  // Employee path: mask both "exists" and "created" with uniform 202 to prevent enumeration
  if (!isAdminRegistration && existing) {
    return NextResponse.json(
      { status: "accepted", message: "Registrazione ricevuta. Se l'indirizzo è valido riceverai una conferma." },
      { status: 202 }
    );
  }

  const passwordHash = await hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: isAdminRegistration ? "ADMIN" : "EMPLOYEE",
      active: isAdminRegistration ? true : false,
    },
  });

  if (isAdminRegistration) {
    return NextResponse.json(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { status: 201 }
    );
  }

  return NextResponse.json(
    { status: "accepted", message: "Registrazione ricevuta. Se l'indirizzo è valido riceverai una conferma." },
    { status: 202 }
  );
}
