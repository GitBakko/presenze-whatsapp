import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { checkAuth } from "@/lib/auth-guard";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await checkAuth();
  if (denied) return denied;

  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) {
    return NextResponse.json({ error: "Dipendente non trovato" }, { status: 404 });
  }
  return NextResponse.json({
    id: employee.id,
    name: employee.name,
    displayName: employee.displayName,
    avatarUrl: employee.avatarUrl,
    aliases: JSON.parse(employee.aliases) as string[],
    hireDate: employee.hireDate?.toISOString().split("T")[0] ?? null,
    contractType: employee.contractType,
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

  const updateData: { displayName?: string | null; avatarUrl?: string; hireDate?: Date | null; contractType?: string } = {};

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

  const updated = await prisma.employee.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    displayName: updated.displayName,
    avatarUrl: updated.avatarUrl,
    aliases: JSON.parse(updated.aliases) as string[],
    hireDate: updated.hireDate?.toISOString().split("T")[0] ?? null,
    contractType: updated.contractType,
  });
}
