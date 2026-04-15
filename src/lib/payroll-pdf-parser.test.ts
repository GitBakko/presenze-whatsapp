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
