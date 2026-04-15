import { describe, it, expect } from "vitest";
import { computeMappedBalance, fuseRolFromPdf } from "./payroll-import-mapping";

describe("fuseRolFromPdf", () => {
  it("sums FES and PER fields component-wise", () => {
    const result = fuseRolFromPdf(
      { resAP: 0, maturato: 8, goduto: 0, residuo: 8 },
      { resAP: 7.01, maturato: 14, goduto: 0, residuo: 21.01 }
    );
    expect(result.resAP).toBeCloseTo(7.01, 2);
    expect(result.maturato).toBeCloseTo(22, 2);
    expect(result.goduto).toBeCloseTo(0, 2);
    expect(result.residuo).toBeCloseTo(29.01, 2);
  });
});

describe("computeMappedBalance", () => {
  it("Brunelli case: sets carryOver and adjust so remaining matches PDF", () => {
    const out = computeMappedBalance({
      pdfFer: { resAP: 24.65, maturato: 5.50, goduto: 0, residuo: 30.15 },
      pdfRol: { resAP: 7.01, maturato: 22, goduto: 0, residuo: 29.01 },
      appVacationAccrued: 6.0,
      appVacationUsed: 0,
      appRolAccrued: 6.0,
      appRolUsed: 0,
    });
    expect(out.vacationCarryOver).toBeCloseTo(24.65, 2);
    expect(out.vacationAccrualAdjust).toBeCloseTo(-0.50, 2);
    expect(out.rolCarryOver).toBeCloseTo(7.01, 2);
    expect(out.rolAccrualAdjust).toBeCloseTo(16.00, 2);
  });

  it("preserves negative resAP", () => {
    const out = computeMappedBalance({
      pdfFer: { resAP: -0.19, maturato: 5.5, goduto: 3, residuo: 2.31 },
      pdfRol: { resAP: 0, maturato: 22, goduto: 11, residuo: 11 },
      appVacationAccrued: 5.5,
      appVacationUsed: 3,
      appRolAccrued: 22,
      appRolUsed: 11,
    });
    expect(out.vacationCarryOver).toBeCloseTo(-0.19, 2);
    expect(out.vacationAccrualAdjust).toBeCloseTo(0, 2);
  });

  it("is idempotent: applying mapping then re-applying yields same outputs", () => {
    const inputs = {
      pdfFer: { resAP: 24.65, maturato: 5.50, goduto: 0, residuo: 30.15 },
      pdfRol: { resAP: 7.01, maturato: 22, goduto: 0, residuo: 29.01 },
      appVacationAccrued: 6.0,
      appVacationUsed: 0,
      appRolAccrued: 6.0,
      appRolUsed: 0,
    };
    const first = computeMappedBalance(inputs);
    const second = computeMappedBalance(inputs);
    expect(second).toEqual(first);
  });
});
