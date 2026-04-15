import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth-guard";
import { buildPreview } from "@/lib/payroll-import-service";
import { PayrollParseError } from "@/lib/payroll-pdf-parser";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const denied = await checkAuth();
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Richiesta non valida (atteso multipart/form-data)" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo 'file' mancante" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File troppo grande (max 5MB)" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return NextResponse.json({ error: "Il file deve essere un PDF" }, { status: 415 });
  }

  try {
    const preview = await buildPreview(buffer);
    const { parsed: _parsed, ...payload } = preview;
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof PayrollParseError) {
      return NextResponse.json(
        { error: e.message, hint: e.hint, kind: e.kind },
        { status: 422 }
      );
    }
    const err = e as Error & { kind?: string };
    if (err.kind === "duplicate-matricola") {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[payroll-import/preview] unexpected", e);
    return NextResponse.json({ error: "Errore interno durante il parsing" }, { status: 500 });
  }
}
