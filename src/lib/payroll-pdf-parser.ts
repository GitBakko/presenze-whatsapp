import pdfParse from "pdf-parse";

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

  return { year, month, sourceMonthLabel, ditta, rows: [] };
}
