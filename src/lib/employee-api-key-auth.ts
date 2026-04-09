/**
 * Autenticazione tramite EmployeeApiKey personale.
 *
 * Pattern identico a `api-key-auth.ts` (globale) ma cerca nella tabella
 * `EmployeeApiKey` invece di `ApiKey`, e restituisce l'`employeeId`
 * associato alla chiave.
 */

import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";

export interface EmployeeKeyResult {
  valid: true;
  employeeId: string;
}

export interface EmployeeKeyInvalid {
  valid: false;
}

/**
 * Valida l'header `Authorization: Bearer <key>` contro la tabella
 * `EmployeeApiKey`. Se la chiave esiste, è attiva, e appartiene a un
 * dipendente, restituisce `{ valid: true, employeeId }`.
 */
export async function validateEmployeeApiKey(
  request: NextRequest
): Promise<EmployeeKeyResult | EmployeeKeyInvalid> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return { valid: false };

  const token = authHeader.slice(7);
  const hash = createHash("sha256").update(token).digest("hex");

  const key = await prisma.employeeApiKey.findUnique({
    where: { keyHash: hash },
  });

  if (!key || !key.active) return { valid: false };

  return { valid: true, employeeId: key.employeeId };
}
