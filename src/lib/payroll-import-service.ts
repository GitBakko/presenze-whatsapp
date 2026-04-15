import { createHash } from "crypto";
import { prisma } from "./db";
import { computeLeaveBalance } from "./leaves";
import { parsePayrollPdf, type PayrollPdfParseResult, type PayrollPdfRow } from "./payroll-pdf-parser";
import { computeMappedBalance, fuseRolFromPdf } from "./payroll-import-mapping";

export interface DiffPair {
  currentRemaining: number;
  newRemaining: number;
  currentCarryOver: number;
  newCarryOver: number;
  currentAdjust: number;
  newAdjust: number;
}

export interface PreviewRow {
  matricola: string;
  cognomePdf: string;
  nomePdf: string;
  matched: boolean;
  employeeId: string | null;
  employeeDisplayName: string | null;
  vacation: DiffPair;
  rol: DiffPair;
  warnings: string[];
}

export interface PreviewResult {
  year: number;
  sourceMonthLabel: string;
  fileHash: string;
  alreadyImported: { importId: string; createdAt: string } | null;
  rows: PreviewRow[];
  orphans: { employeeId: string; displayName: string }[];
  parsed: PayrollPdfParseResult;
}

const ZERO_DIFF: DiffPair = {
  currentRemaining: 0,
  newRemaining: 0,
  currentCarryOver: 0,
  newCarryOver: 0,
  currentAdjust: 0,
  newAdjust: 0,
};

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function checkDuplicateMatricole(rows: PayrollPdfRow[]): string[] {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.matricola, (seen.get(r.matricola) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([m]) => m);
}

export async function buildPreview(buffer: Buffer): Promise<PreviewResult> {
  const parsed = await parsePayrollPdf(buffer);
  const fileHash = sha256Hex(buffer);

  const dupes = checkDuplicateMatricole(parsed.rows);
  if (dupes.length > 0) {
    const e = new Error(`Matricole duplicate nel PDF: ${dupes.join(", ")}`);
    (e as Error & { kind: string }).kind = "duplicate-matricola";
    throw e;
  }

  const previousImport = await prisma.payrollImport.findFirst({
    where: { fileHash },
    orderBy: { createdAt: "desc" },
  });

  const matricole = parsed.rows.map((r) => r.matricola);
  const matchedEmployees = await prisma.employee.findMany({
    where: { payrollId: { in: matricole } },
    select: { id: true, displayName: true, name: true, payrollId: true },
  });
  const byPayrollId = new Map(matchedEmployees.map((e) => [e.payrollId!, e]));

  const rows: PreviewRow[] = [];
  for (const pdfRow of parsed.rows) {
    const emp = byPayrollId.get(pdfRow.matricola);
    if (!emp) {
      rows.push({
        matricola: pdfRow.matricola,
        cognomePdf: pdfRow.cognome,
        nomePdf: pdfRow.nome,
        matched: false,
        employeeId: null,
        employeeDisplayName: null,
        vacation: ZERO_DIFF,
        rol: ZERO_DIFF,
        warnings: [...pdfRow.warnings, "Matricola non associata a nessun dipendente"],
      });
      continue;
    }

    const summary = await computeLeaveBalance(emp.id, parsed.year);
    const pdfRol = fuseRolFromPdf(pdfRow.fes, pdfRow.per);
    const mapped = computeMappedBalance({
      pdfFer: pdfRow.fer,
      pdfRol,
      appVacationAccrued: summary.vacationAccrued,
      appVacationUsed: summary.vacationUsed,
      appRolAccrued: summary.rolAccrued,
      appRolUsed: summary.rolUsed,
    });

    rows.push({
      matricola: pdfRow.matricola,
      cognomePdf: pdfRow.cognome,
      nomePdf: pdfRow.nome,
      matched: true,
      employeeId: emp.id,
      employeeDisplayName: emp.displayName ?? emp.name,
      vacation: {
        currentRemaining: summary.vacationRemaining,
        newRemaining: pdfRow.fer.residuo,
        currentCarryOver: summary.vacationCarryOver,
        newCarryOver: mapped.vacationCarryOver,
        currentAdjust: summary.vacationAccrualAdjust,
        newAdjust: mapped.vacationAccrualAdjust,
      },
      rol: {
        currentRemaining: summary.rolRemaining,
        newRemaining: pdfRol.residuo,
        currentCarryOver: summary.rolCarryOver,
        newCarryOver: mapped.rolCarryOver,
        currentAdjust: summary.rolAccrualAdjust,
        newAdjust: mapped.rolAccrualAdjust,
      },
      warnings: pdfRow.warnings,
    });
  }

  const matchedIds = new Set(matchedEmployees.map((e) => e.id));
  const orphansRaw = await prisma.employee.findMany({
    where: {
      OR: [
        { payrollId: { not: null } },
        { balances: { some: { year: parsed.year } } },
      ],
    },
    select: { id: true, displayName: true, name: true },
  });
  const orphans = orphansRaw
    .filter((e) => !matchedIds.has(e.id))
    .map((e) => ({ employeeId: e.id, displayName: e.displayName ?? e.name }));

  return {
    year: parsed.year,
    sourceMonthLabel: parsed.sourceMonthLabel,
    fileHash,
    alreadyImported: previousImport
      ? { importId: previousImport.id, createdAt: previousImport.createdAt.toISOString() }
      : null,
    rows,
    orphans,
    parsed,
  };
}

export interface ConfirmResult {
  importId: string;
  matched: number;
  skipped: number;
  orphans: number;
}

export async function confirmImport(
  buffer: Buffer,
  expectedHash: string,
  fileName: string,
  userId: string
): Promise<ConfirmResult> {
  const preview = await buildPreview(buffer);

  if (preview.fileHash !== expectedHash) {
    const e = new Error("Il file è cambiato rispetto alla preview, ricarica.");
    (e as Error & { kind: string }).kind = "hash-mismatch";
    throw e;
  }

  const unmatched = preview.rows.filter((r) => !r.matched);
  if (unmatched.length > 0) {
    const e = new Error(
      `Matricole non associate: ${unmatched.map((r) => r.matricola).join(", ")}`
    );
    (e as Error & { kind: string }).kind = "unmatched";
    throw e;
  }

  const payloadRows: unknown[] = [];

  const importId = await prisma.$transaction(async (tx) => {
    for (const row of preview.rows) {
      const before = await tx.leaveBalance.findUnique({
        where: { employeeId_year: { employeeId: row.employeeId!, year: preview.year } },
      });

      const beforeSnapshot = {
        vacationCarryOver: before?.vacationCarryOver ?? 0,
        vacationAccrualAdjust: before?.vacationAccrualAdjust ?? 0,
        rolCarryOver: before?.rolCarryOver ?? 0,
        rolAccrualAdjust: before?.rolAccrualAdjust ?? 0,
      };
      const afterSnapshot = {
        vacationCarryOver: row.vacation.newCarryOver,
        vacationAccrualAdjust: row.vacation.newAdjust,
        rolCarryOver: row.rol.newCarryOver,
        rolAccrualAdjust: row.rol.newAdjust,
      };

      await tx.leaveBalance.upsert({
        where: { employeeId_year: { employeeId: row.employeeId!, year: preview.year } },
        create: { employeeId: row.employeeId!, year: preview.year, ...afterSnapshot },
        update: afterSnapshot,
      });

      const pdfRow = preview.parsed.rows.find((p) => p.matricola === row.matricola)!;
      payloadRows.push({
        matricola: row.matricola,
        cognomePdf: row.cognomePdf,
        nomePdf: row.nomePdf,
        employeeId: row.employeeId,
        before: beforeSnapshot,
        after: afterSnapshot,
        pdfValues: { fer: pdfRow.fer, fes: pdfRow.fes, per: pdfRow.per },
        warnings: row.warnings,
      });
    }

    const created = await tx.payrollImport.create({
      data: {
        userId,
        fileName,
        fileHash: preview.fileHash,
        year: preview.year,
        sourceMonth: preview.sourceMonthLabel,
        totalEmployees: preview.parsed.rows.length,
        matchedEmployees: preview.rows.filter((r) => r.matched).length,
        skippedEmployees: 0,
        orphanEmployees: preview.orphans.length,
        payload: JSON.stringify({ rows: payloadRows, orphans: preview.orphans }),
      },
    });
    return created.id;
  });

  return {
    importId,
    matched: preview.rows.length,
    skipped: 0,
    orphans: preview.orphans.length,
  };
}
