import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";

/**
 * Valida l'header `Authorization: Bearer <key>` confrontando l'hash SHA-256
 * della chiave con `ApiKey.keyHash` nel database. Restituisce true sse la
 * chiave esiste ed è attiva.
 *
 * Pattern usato da `/api/external/leaves` e `/api/kiosk/punch`.
 */
export async function validateApiKey(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7);
  const hash = createHash("sha256").update(token).digest("hex");

  const key = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  return key !== null && key.active;
}
