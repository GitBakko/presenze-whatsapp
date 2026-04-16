import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { sendMail } from "@/lib/mail-send";
import { notifyLeaveCancellation } from "@/lib/telegram-handlers";
import { getTelegramBot } from "@/lib/telegram-bot";

/**
 * GET /api/settings/users
 * Lista utenti per la pagina di attivazione admin.
 *
 * POST /api/settings/users
 * Attiva un utente, opzionalmente associandolo a un dipendente.
 * Body: { userId, employeeId? }  — employeeId può essere null per utenti solo-admin
 *
 * DELETE /api/settings/users?id=<userId>
 * Disattiva un utente (active=false, employeeId=null).
 */

export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const users = await prisma.user.findMany({
    orderBy: [{ active: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      employeeId: true,
      createdAt: true,
      receiveLeaveNotifications: true,
      receiveMonthlyReport: true,
      employee: {
        select: { id: true, name: true, displayName: true },
      },
    },
  });

  // Per gli utenti in attesa, suggerisci un match employee per email
  const employees = await prisma.employee.findMany({
    select: { id: true, name: true, displayName: true, email: true },
    orderBy: { name: "asc" },
  });

  const pendingUsers = users.filter((u) => !u.active && u.role === "EMPLOYEE");
  const activeUsers = users.filter((u) => u.active);

  // Suggerisci match per email
  const suggestions: Record<string, string> = {};
  for (const pu of pendingUsers) {
    const match = employees.find(
      (e) => e.email && e.email.toLowerCase() === pu.email.toLowerCase()
    );
    if (match) suggestions[pu.id] = match.id;
  }

  return NextResponse.json({
    pending: pendingUsers.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt.toISOString(),
      suggestedEmployeeId: suggestions[u.id] ?? null,
    })),
    active: activeUsers.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      employeeId: u.employeeId,
      employeeName: u.employee
        ? u.employee.displayName || u.employee.name
        : null,
      createdAt: u.createdAt.toISOString(),
      receiveLeaveNotifications: u.receiveLeaveNotifications,
      receiveMonthlyReport: u.receiveMonthlyReport,
    })),
    employees: employees.map((e) => ({
      id: e.id,
      name: e.displayName || e.name,
      email: e.email,
    })),
  });
}

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { userId, employeeId } = body as {
    userId: string;
    employeeId: string | null;
  };

  if (!userId) {
    return NextResponse.json(
      { error: "userId obbligatorio" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
  }

  // Only validate employee when an association is requested
  let employee = null;
  if (employeeId) {
    employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) {
      return NextResponse.json(
        { error: "Dipendente non trovato" },
        { status: 404 }
      );
    }

    // Verifica che l'employee non sia già associato a un altro user
    const existingLink = await prisma.user.findUnique({
      where: { employeeId },
    });
    if (existingLink && existingLink.id !== userId) {
      return NextResponse.json(
        { error: "Questo dipendente è già associato a un altro utente" },
        { status: 409 }
      );
    }
  }

  // Attiva e associa (employeeId può essere null per utenti solo-admin)
  await prisma.user.update({
    where: { id: userId },
    data: { active: true, employeeId: employeeId || null },
  });

  // ── Notifica al dipendente ─────────────────────────────────────────
  const portalUrl = process.env.NEXTAUTH_URL || "https://hr.epartner.it";

  // Email (solo se c'è un dipendente associato con email)
  if (employee && employee.email) {
    try {
      await sendMail({
        to: employee.email,
        subject: "Il tuo account ePartner HR è attivo",
        text:
          `Ciao ${employee.displayName || employee.name},\n\n` +
          `il tuo account sul portale ePartner HR è stato attivato.\n\n` +
          `Puoi accedere da: ${portalUrl}\n` +
          `Email: ${user.email}\n` +
          `Password: quella che hai scelto durante la registrazione\n\n` +
          `— ePartner HR`,
      });
    } catch (err) {
      console.error("[users/POST] sendMail activation failed:", err);
    }
  }

  // Telegram (solo se c'è un dipendente associato con chatId)
  if (employee && employee.telegramChatId) {
    const bot = getTelegramBot();
    if (bot) {
      try {
        await bot.sendMessage({
          chat_id: employee.telegramChatId,
          text:
            `✅ Il tuo account <b>ePartner HR</b> è stato attivato!\n\n` +
            `Puoi accedere al portale da:\n${portalUrl}\n\n` +
            `Email: <code>${user.email}</code>\n` +
            `Password: quella scelta durante la registrazione`,
          parse_mode: "HTML",
        });
      } catch (err) {
        console.error("[users/POST] telegram activation failed:", err);
      }
    }
  }

  void notifyLeaveCancellation; // unused import ref suppression

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obbligatorio" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id },
    data: { active: false, employeeId: null },
  });

  return NextResponse.json({ ok: true });
}

/** PATCH — aggiorna il ruolo o le preferenze di notifica di un utente attivo. */
export async function PATCH(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  const body = await request.json();
  const { userId, role, receiveLeaveNotifications } = body as {
    userId: string;
    role?: string;
    receiveLeaveNotifications?: boolean;
  };

  if (!userId) {
    return NextResponse.json({ error: "userId obbligatorio" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (role !== undefined) {
    if (!["ADMIN", "EMPLOYEE"].includes(role)) {
      return NextResponse.json(
        { error: "role deve essere ADMIN o EMPLOYEE" },
        { status: 400 }
      );
    }
    data.role = role;
  }

  if (typeof receiveLeaveNotifications === "boolean") {
    data.receiveLeaveNotifications = receiveLeaveNotifications;
  }

  if (typeof body.receiveMonthlyReport === "boolean") {
    data.receiveMonthlyReport = body.receiveMonthlyReport;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nessun campo da aggiornare" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) {
    return NextResponse.json({ error: "Utente non trovato o non attivo" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: userId },
    data,
  });

  return NextResponse.json({ ok: true });
}
