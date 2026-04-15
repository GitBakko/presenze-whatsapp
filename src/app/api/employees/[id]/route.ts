import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { checkAuth, checkAuthAny, isAuthUser, resolveEmployeeId } from "@/lib/auth-guard";

/** Normalizza un UID NFC: hex uppercase, niente separatori. Stringa vuota se input non valido. */
function normalizeNfcUid(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Employee può vedere il proprio profilo, admin vede tutti
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;
  const { id } = await params;
  if (authResult.role === "EMPLOYEE") {
    const ownEmpId = await resolveEmployeeId(authResult);
    if (ownEmpId !== id) {
      return NextResponse.json({ error: "Accesso non autorizzato" }, { status: 403 });
    }
  }
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  // Carica anche il saldo dell'anno corrente per precompilare il form
  const currentYear = new Date().getFullYear();
  const balance = await prisma.leaveBalance.findUnique({
    where: { employeeId_year: { employeeId: id, year: currentYear } },
  });

  return NextResponse.json({
    id: employee.id,
    name: employee.name,
    displayName: employee.displayName,
    avatarUrl: employee.avatarUrl,
    aliases: JSON.parse(employee.aliases) as string[],
    hireDate: employee.hireDate?.toISOString().split("T")[0] ?? null,
    contractType: employee.contractType,
    nfcUid: employee.nfcUid,
    telegramChatId: employee.telegramChatId,
    telegramUsername: employee.telegramUsername,
    email: employee.email,
    payrollId: employee.payrollId,
    vacationCarryOver: balance?.vacationCarryOver ?? 0,
    rolCarryOver: balance?.rolCarryOver ?? 0,
    vacationAccrualAdjust: balance?.vacationAccrualAdjust ?? 0,
    rolAccrualAdjust: balance?.rolAccrualAdjust ?? 0,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const formData = await request.formData();
  const displayName = formData.get("displayName") as string | null;
  const avatarFile = formData.get("avatar") as File | null;

  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }

  const hireDate = formData.get("hireDate") as string | null;
  const contractType = formData.get("contractType") as string | null;
  const nfcUidRaw = formData.get("nfcUid") as string | null;
  const telegramChatIdRaw = formData.get("telegramChatId") as string | null;
  const telegramUsernameRaw = formData.get("telegramUsername") as string | null;
  const emailRaw = formData.get("email") as string | null;
  const payrollIdRaw = formData.get("payrollId") as string | null;

  // Saldi ferie/permessi (anno corrente). Tutti opzionali. Se almeno
  // uno e' presente nel form, facciamo upsert sulla tabella LeaveBalance
  // dopo l'update dell'employee.
  const vacationCarryOverRaw = formData.get("vacationCarryOver") as string | null;
  const rolCarryOverRaw = formData.get("rolCarryOver") as string | null;
  const vacationAccrualAdjustRaw = formData.get("vacationAccrualAdjust") as string | null;
  const rolAccrualAdjustRaw = formData.get("rolAccrualAdjust") as string | null;

  const updateData: {
    displayName?: string | null;
    avatarUrl?: string;
    hireDate?: Date | null;
    contractType?: string;
    nfcUid?: string | null;
    telegramChatId?: string | null;
    telegramUsername?: string | null;
    email?: string | null;
    payrollId?: string | null;
  } = {};

  // Update display name (empty string = reset to null/use original name)
  if (displayName !== null) {
    updateData.displayName = displayName.trim() || null;
  }

  // Update hire date
  if (hireDate !== null) {
    updateData.hireDate = hireDate ? new Date(hireDate) : null;
  }

  // Update contract type
  if (contractType && ["FULL_TIME", "PART_TIME"].includes(contractType)) {
    updateData.contractType = contractType;
  }

  // Update NFC UID (stringa vuota = scollega tessera)
  if (nfcUidRaw !== null) {
    const trimmed = nfcUidRaw.trim();
    if (trimmed === "") {
      updateData.nfcUid = null;
    } else {
      const uid = normalizeNfcUid(trimmed);
      if (!uid) {
        return NextResponse.json(
          { error: "UID NFC non valido (sono ammessi solo caratteri esadecimali)" },
          { status: 400 }
        );
      }
      updateData.nfcUid = uid;
    }
  }

  // Update Telegram chat_id (stringa vuota = scollega bot)
  if (telegramChatIdRaw !== null) {
    const trimmed = telegramChatIdRaw.trim();
    if (trimmed === "") {
      updateData.telegramChatId = null;
    } else if (!/^-?\d+$/.test(trimmed)) {
      return NextResponse.json(
        { error: "telegramChatId deve essere un id numerico Telegram" },
        { status: 400 }
      );
    } else {
      updateData.telegramChatId = trimmed;
    }
  }

  // Update Telegram username (cosmetico, stringa vuota = null)
  if (telegramUsernameRaw !== null) {
    const trimmed = telegramUsernameRaw.trim().replace(/^@/, "");
    updateData.telegramUsername = trimmed || null;
  }

  // Update email (stringa vuota = scollega)
  if (emailRaw !== null) {
    const trimmed = emailRaw.trim().toLowerCase();
    if (trimmed === "") {
      updateData.email = null;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json({ error: "Formato email non valido" }, { status: 400 });
    } else {
      updateData.email = trimmed;
    }
  }

  // Update payrollId (matricola paghe). Stringa vuota = scollega.
  if (payrollIdRaw !== null) {
    const trimmed = payrollIdRaw.trim();
    updateData.payrollId = trimmed === "" ? null : trimmed;
  }

  // Handle avatar upload
  if (avatarFile && avatarFile.size > 0) {
    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(avatarFile.type)) {
      return NextResponse.json(
        { error: "Tipo file non supportato. Usa JPG, PNG, WebP o GIF." },
        { status: 400 }
      );
    }
    // Limit size to 2MB
    if (avatarFile.size > 2 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File troppo grande. Massimo 2MB." },
        { status: 400 }
      );
    }

    const ext = avatarFile.type.split("/")[1] === "jpeg" ? "jpg" : avatarFile.type.split("/")[1];
    const filename = `${id}-${randomBytes(4).toString("hex")}.${ext}`;
    const bytes = await avatarFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const uploadPath = join(process.cwd(), "public", "uploads", "avatars", filename);
    await writeFile(uploadPath, buffer);
    updateData.avatarUrl = `/uploads/avatars/${filename}`;
  }

  // ── Upsert LeaveBalance per l'anno corrente ─────────────────────
  // Solo se almeno uno dei 4 campi e' stato passato dal form. Tutti
  // accettano stringa vuota = 0 e numeri (anche negativi per gli adjust).
  const balanceFieldsPresent =
    vacationCarryOverRaw !== null ||
    rolCarryOverRaw !== null ||
    vacationAccrualAdjustRaw !== null ||
    rolAccrualAdjustRaw !== null;

  if (balanceFieldsPresent) {
    const parseFloatField = (raw: string | null): number | undefined => {
      if (raw === null) return undefined;
      const trimmed = raw.trim();
      if (trimmed === "") return 0;
      const n = parseFloat(trimmed.replace(",", "."));
      return Number.isFinite(n) ? n : undefined;
    };

    const vCO = parseFloatField(vacationCarryOverRaw);
    const rCO = parseFloatField(rolCarryOverRaw);
    const vAdj = parseFloatField(vacationAccrualAdjustRaw);
    const rAdj = parseFloatField(rolAccrualAdjustRaw);

    if (vCO === undefined || rCO === undefined || vAdj === undefined || rAdj === undefined) {
      return NextResponse.json(
        { error: "Saldi non validi: usa numeri (es. 2.5 oppure -1)" },
        { status: 400 }
      );
    }

    const currentYear = new Date().getFullYear();
    const data: Record<string, number | undefined> = {};
    if (vacationCarryOverRaw !== null) data.vacationCarryOver = vCO;
    if (rolCarryOverRaw !== null) data.rolCarryOver = rCO;
    if (vacationAccrualAdjustRaw !== null) data.vacationAccrualAdjust = vAdj;
    if (rolAccrualAdjustRaw !== null) data.rolAccrualAdjust = rAdj;

    await prisma.leaveBalance.upsert({
      where: { employeeId_year: { employeeId: id, year: currentYear } },
      create: {
        employeeId: id,
        year: currentYear,
        vacationCarryOver: vCO,
        rolCarryOver: rCO,
        vacationAccrualAdjust: vAdj,
        rolAccrualAdjust: rAdj,
      },
      update: data,
    });
  }

  let updated;
  try {
    updated = await prisma.employee.update({
      where: { id },
      data: updateData,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta as { target?: string[] | string } | undefined)?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
      const msg = targetStr.includes("telegram")
        ? "Chat Telegram già associata a un altro dipendente"
        : targetStr.includes("email")
        ? "Email già associata a un altro dipendente"
        : targetStr.includes("payrollId")
        ? "Matricola paghe già associata a un altro dipendente"
        : "UID NFC già associato a un altro dipendente";
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    displayName: updated.displayName,
    avatarUrl: updated.avatarUrl,
    aliases: JSON.parse(updated.aliases) as string[],
    hireDate: updated.hireDate?.toISOString().split("T")[0] ?? null,
    contractType: updated.contractType,
    nfcUid: updated.nfcUid,
    telegramChatId: updated.telegramChatId,
    telegramUsername: updated.telegramUsername,
    email: updated.email,
    payrollId: updated.payrollId,
  });
}
