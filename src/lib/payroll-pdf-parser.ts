import pdfParse from "pdf-parse";

function parseItalianNumber(raw: string): number {
  const t = raw.trim();
  if (!t) return 0;
  const negative = t.endsWith("-");
  const stripped = (negative ? t.slice(0, -1) : t).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(stripped);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

function parseRowCells(line: string): string[] {
  return line.split("!").slice(1, -1).map((s) => s.trim());
}

const CATEGORY_CODES = new Set(["FER", "FES", "PER", "B.O"]);

interface ParsedLine {
  col1: string;
  col2: string;
  code: string;
  values: string[]; // 16 raw cells: 12 months + resAP + maturato + goduto + residuo
}

function parseLine(line: string): ParsedLine | null {
  const cells = parseRowCells(line);
  if (cells.length < 19) return null;
  const code = cells[2];
  if (!CATEGORY_CODES.has(code)) return null;
  return {
    col1: cells[0],
    col2: cells[1],
    code,
    values: cells.slice(3, 19), // indices 3..18 → 16 values
  };
}

function readCategory(values: string[]): PayrollCategoryValues {
  return {
    resAP: parseItalianNumber(values[12]),
    maturato: parseItalianNumber(values[13]),
    goduto: parseItalianNumber(values[14]),
    residuo: parseItalianNumber(values[15]),
  };
}

export interface PayrollCategoryValues {
  resAP: number;
  maturato: number;
  goduto: number;
  residuo: number;
}

export interface PayrollPdfRow {
  matricola: string;
  cognome: string;
  nome: string;
  fer: PayrollCategoryValues;
  fes: PayrollCategoryValues;
  per: PayrollCategoryValues;
  warnings: string[];
}

export interface PayrollPdfParseResult {
  year: number;
  month: number;
  sourceMonthLabel: string;
  ditta: string;
  rows: PayrollPdfRow[];
}

export class PayrollParseError extends Error {
  constructor(public kind: string, message: string, public hint?: string) {
    super(message);
    this.name = "PayrollParseError";
  }
}

const MONTH_MAP: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

export async function parsePayrollPdf(buffer: Buffer): Promise<PayrollPdfParseResult> {
  const data = await pdfParse(buffer);
  const text = data.text;

  const headerMatch = text.match(/al mese di\s+(\w+)\s+(\d{4})/i);
  if (!headerMatch) {
    throw new PayrollParseError(
      "missing-header",
      "Impossibile determinare l'anno di riferimento dal PDF",
      "Verifica che il PDF sia un tabulato standard (intestazione 'al mese di <Mese> <Anno>')."
    );
  }
  const monthName = headerMatch[1].toLowerCase();
  const month = MONTH_MAP[monthName];
  const year = parseInt(headerMatch[2], 10);
  if (!month) {
    throw new PayrollParseError("invalid-month", `Mese non riconosciuto: ${headerMatch[1]}`);
  }

  const sourceMonthLabel = `${headerMatch[1][0].toUpperCase()}${monthName.slice(1)} ${year}`;

  const dittaMatch = text.match(/Ditta\s+([A-Z]+)/);
  const ditta = dittaMatch?.[1] ?? "";
  if (ditta !== "EPARTE") {
    throw new PayrollParseError(
      "unsupported-company",
      `PDF di azienda non supportata: ${ditta || "(sconosciuta)"}`,
      "Questo strumento è configurato solo per la ditta EPARTE."
    );
  }

  const lines = text.split(/\r?\n/);
  const parsedLines: ParsedLine[] = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed) parsedLines.push(parsed);
  }

  // Group into 4-row blocks (FER, FES, PER, B.O) per employee.
  const rows: PayrollPdfRow[] = [];
  for (let i = 0; i + 3 < parsedLines.length; i += 4) {
    const fer = parsedLines[i];
    const fes = parsedLines[i + 1];
    const per = parsedLines[i + 2];
    const bo = parsedLines[i + 3];
    if (fer.code !== "FER" || fes.code !== "FES" || per.code !== "PER" || bo.code !== "B.O") {
      continue;
    }
    const matricola = fer.col1;
    if (!/^\d+$/.test(matricola)) continue;
    const cognome = fes.col1;
    const nome = per.col1;

    const ferValues = readCategory(fer.values);
    const fesValues = readCategory(fes.values);
    const perValues = readCategory(per.values);

    const warnings: string[] = [];
    for (const [code, c] of [["FER", ferValues], ["FES", fesValues], ["PER", perValues]] as const) {
      const expected = c.resAP + c.maturato - c.goduto;
      if (Math.abs(expected - c.residuo) > 0.05) {
        warnings.push(
          `${code}: residuo nel PDF (${c.residuo}) non quadra con resAP+maturato-goduto (${expected.toFixed(2)})`
        );
      }
    }

    rows.push({ matricola, cognome, nome, fer: ferValues, fes: fesValues, per: perValues, warnings });
  }

  return { year, month, sourceMonthLabel, ditta, rows };
}
