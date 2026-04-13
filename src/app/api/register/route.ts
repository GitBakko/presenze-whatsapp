import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";

/**
 * POST /api/register
 *
 * Due modalità di registrazione:
 *
 * 1. Admin: passa `systemPassword` = SYSTEM_REGISTRATION_SECRET →
 *    crea utente con role="ADMIN", active=true. Usata per bootstrap
 *    iniziale o per creare admin aggiuntivi.
 *
 * 2. Dipendente: senza `systemPassword`, email deve terminare con
 *    uno dei domini consentiti (default @epartner.it) → crea utente
 *    con role="EMPLOYEE", active=false. L'admin dovrà attivarlo e
 *    associarlo a un dipendente dalla pagina Impostazioni → Utenti.
 */

const ALLOWED_DOMAINS = ["epartner.it"];

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, name, password, systemPassword } = body;

  if (!email || !name || !password) {
    return NextResponse.json(
      { error: "Tutti i campi sono obbligatori (email, name, password)" },
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

  // Determina il tipo di registrazione
  const isAdminRegistration =
    systemPassword && systemPassword === process.env.SYSTEM_REGISTRATION_SECRET;

  if (systemPassword && !isAdminRegistration) {
    return NextResponse.json(
      { error: "Password di sistema non valida" },
      { status: 403 }
    );
  }

  // Per registrazioni dipendente: verifica dominio email
  if (!isAdminRegistration) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!ALLOWED_DOMAINS.includes(domain)) {
      return NextResponse.json(
        {
          error: `La registrazione è consentita solo per indirizzi @${ALLOWED_DOMAINS.join(", @")}`,
        },
        { status: 403 }
      );
    }
  }

  // Check se esiste già
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Un utente con questa email esiste già" },
      { status: 409 }
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

  // Registrazione dipendente: messaggio di attesa
  return NextResponse.json(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      active: false,
      message:
        "Registrazione completata. Il tuo account sarà attivato dall'amministratore.",
    },
    { status: 201 }
  );
}
