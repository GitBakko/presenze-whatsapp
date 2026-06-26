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
  it("aligns carryOver + accrued + adjust = residuo (goduto stays in the carico, not added back)", () => {
    const out = computeMappedBalance({
      pdfFer: { resAP: 24.65, maturato: 5.50, goduto: 0, residuo: 30.15 },
      pdfRol: { resAP: 7.01, maturato: 22, goduto: 0, residuo: 29.01 },
      appVacationAccrued: 6.0,
      appRolAccrued: 6.0,
    });
    expect(out.vacationCarryOver).toBeCloseTo(24.65, 2);
    expect(out.vacationAccrualAdjust).toBeCloseTo(-0.50, 2); // 30.15 − (24.65 + 6)
    expect(out.rolCarryOver).toBeCloseTo(7.01, 2);
    expect(out.rolAccrualAdjust).toBeCloseTo(16.00, 2); // 29.01 − (7.01 + 6)
  });

  it("Stefano Maggio: residuo 31.82, accrued 12 → carryOver 22.65, adjust −2.83", () => {
    const out = computeMappedBalance({
      pdfFer: { resAP: 22.65, maturato: 9.17, goduto: 0, residuo: 31.82 },
      pdfRol: { resAP: 0, maturato: 0, goduto: 0, residuo: 28.77 },
      appVacationAccrued: 12,
      appRolAccrued: 0,
    });
    expect(out.vacationCarryOver).toBeCloseTo(22.65, 2);
    expect(out.vacationAccrualAdjust).toBeCloseTo(-2.83, 2); // 31.82 − (22.65 + 12)
  });

  it("does NOT add back goduto/used — adjust depends only on residuo, resAP, accrued", () => {
    const out = computeMappedBalance({
      pdfFer: { resAP: -0.19, maturato: 5.5, goduto: 3, residuo: 2.31 },
      pdfRol: { resAP: 0, maturato: 22, goduto: 11, residuo: 11 },
      appVacationAccrued: 5.5,
      appRolAccrued: 22,
    });
    expect(out.vacationCarryOver).toBeCloseTo(-0.19, 2);
    expect(out.vacationAccrualAdjust).toBeCloseTo(-3.0, 2); // 2.31 − (−0.19 + 5.5)
    expect(out.rolAccrualAdjust).toBeCloseTo(-11.0, 2); // 11 − (0 + 22)
  });

  it("is idempotent: applying mapping then re-applying yields same outputs", () => {
    const inputs = {
      pdfFer: { resAP: 24.65, maturato: 5.50, goduto: 0, residuo: 30.15 },
      pdfRol: { resAP: 7.01, maturato: 22, goduto: 0, residuo: 29.01 },
      appVacationAccrued: 6.0,
      appRolAccrued: 6.0,
    };
    const first = computeMappedBalance(inputs);
    const second = computeMappedBalance(inputs);
    expect(second).toEqual(first);
  });
});
