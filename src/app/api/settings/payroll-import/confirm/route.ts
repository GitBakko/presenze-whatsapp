import { NextRequest, NextResponse } from "next/server";
import { checkAuthAny, isAuthUser } from "@/lib/auth-guard";
import { confirmImport } from "@/lib/payroll-import-service";
import { PayrollParseError } from "@/lib/payroll-pdf-parser";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const authResult = await checkAuthAny();
  if (!isAuthUser(authResult)) return authResult;
  if (authResult.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Accesso riservato agli amministratori" },
      { status: 403 }
    );
  }
  const userId = authResult.id;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }

  const file = formData.get("file");
  const expectedHash = formData.get("confirmHash");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo 'file' mancante" }, { status: 400 });
  }
  if (typeof expectedHash !== "string" || !expectedHash) {
    return NextResponse.json({ error: "Campo 'confirmHash' mancante" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File troppo grande (max 5MB)" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return NextResponse.json({ error: "Il file deve essere un PDF" }, { status: 415 });
  }

  try {
    const result = await confirmImport(buffer, expectedHash, file.name, userId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PayrollParseError) {
      return NextResponse.json(
        { error: e.message, hint: e.hint, kind: e.kind },
        { status: 422 }
      );
    }
    const err = e as Error & { kind?: string };
    if (err.kind === "hash-mismatch" || err.kind === "duplicate-matricola") {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err.kind === "unmatched") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[payroll-import/confirm] unexpected", e);
    return NextResponse.json({ error: "Errore interno durante la conferma" }, { status: 500 });
  }
}
