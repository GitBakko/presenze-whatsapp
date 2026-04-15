import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePayrollPdf } from "./payroll-pdf-parser";

const FIXTURE = readFileSync(
  join(process.cwd(), "prisma/fixtures/tabulato-marzo-2026.pdf")
);

describe("parsePayrollPdf — header", () => {
  it("extracts year, month and source label from header", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
    expect(result.sourceMonthLabel).toBe("Marzo 2026");
    expect(result.ditta).toBe("EPARTE");
  });
});

describe("parsePayrollPdf — rows", () => {
  it("extracts all 9 employees", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    expect(result.rows).toHaveLength(9);
  });

  it("parses Brunelli (matricola 5) — FER values", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "5");
    expect(r).toBeDefined();
    expect(r!.cognome).toBe("BRUNELLI");
    expect(r!.nome).toBe("STEFANO");
    expect(r!.fer.resAP).toBeCloseTo(24.65, 2);
    expect(r!.fer.maturato).toBeCloseTo(5.50, 2);
    expect(r!.fer.goduto).toBeCloseTo(0.00, 2);
    expect(r!.fer.residuo).toBeCloseTo(30.15, 2);
  });

  it("parses Brunelli (matricola 5) — FES and PER values", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "5")!;
    expect(r.fes.residuo).toBeCloseTo(8.00, 2);
    expect(r.per.resAP).toBeCloseTo(7.01, 2);
    expect(r.per.residuo).toBeCloseTo(21.01, 2);
  });

  it("preserves negative resAP for Costieri (matricola 26)", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "26")!;
    expect(r.cognome).toBe("COSTIERI");
    expect(r.fer.resAP).toBeCloseTo(-0.19, 2);
    expect(r.fer.residuo).toBeCloseTo(2.31, 2);
  });

  it("parses Cojocaru (matricola 28) — sparse cells", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "28")!;
    expect(r.cognome).toBe("COJOCARU");
    expect(r.fes.resAP).toBeCloseTo(78.00, 2);
    expect(r.per.resAP).toBeCloseTo(58.00, 2);
    expect(r.per.residuo).toBeCloseTo(72.00, 2);
  });

  it("parses Mengana (matricola 24) — part-time accruals", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    const r = result.rows.find((x) => x.matricola === "24")!;
    expect(r.cognome).toBe("MENGANA");
    expect(r.per.maturato).toBeCloseTo(8.40, 2);
  });

  it("does not include the TOTALI summary row", async () => {
    const result = await parsePayrollPdf(FIXTURE);
    expect(result.rows.find((r) => r.cognome === "TOTALI")).toBeUndefined();
    expect(result.rows.every((r) => /^\d+$/.test(r.matricola))).toBe(true);
  });
});

describe("parsePayrollPdf — errors", () => {
  it("throws on a non-PDF buffer", async () => {
    const fakeBuf = Buffer.from("this is not a pdf");
    await expect(parsePayrollPdf(fakeBuf)).rejects.toThrow();
  });
});
