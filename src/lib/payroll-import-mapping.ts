import type { PayrollCategoryValues } from "./payroll-pdf-parser";

export interface MappedBalance {
  vacationCarryOver: number;
  vacationAccrualAdjust: number;
  rolCarryOver: number;
  rolAccrualAdjust: number;
}

export interface MappingInputs {
  pdfFer: PayrollCategoryValues;
  pdfRol: PayrollCategoryValues; // already fused (fes+per)
  appVacationAccrued: number;
  appVacationUsed: number;
  appRolAccrued: number;
  appRolUsed: number;
}

export function fuseRolFromPdf(
  fes: PayrollCategoryValues,
  per: PayrollCategoryValues
): PayrollCategoryValues {
  return {
    resAP: round2(fes.resAP + per.resAP),
    maturato: round2(fes.maturato + per.maturato),
    goduto: round2(fes.goduto + per.goduto),
    residuo: round2(fes.residuo + per.residuo),
  };
}

export function computeMappedBalance(input: MappingInputs): MappedBalance {
  const vacationCarryOver = input.pdfFer.resAP;
  const vacationAccrualAdjust = round2(
    input.pdfFer.residuo -
      (input.pdfFer.resAP + input.appVacationAccrued - input.appVacationUsed)
  );
  const rolCarryOver = input.pdfRol.resAP;
  const rolAccrualAdjust = round2(
    input.pdfRol.residuo -
      (input.pdfRol.resAP + input.appRolAccrued - input.appRolUsed)
  );
  return { vacationCarryOver, vacationAccrualAdjust, rolCarryOver, rolAccrualAdjust };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
