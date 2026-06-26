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
  appRolAccrued: number;
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
  // The carico residuo is authoritative and ALREADY nets out every goduto up to
  // the tabulato's month. So we align `carryOver + accrued + adjust = residuo`
  // and let the balance recompute subtract only the leaves AFTER the cutoff
  // month (see computeLeaveBalanceFromData `cutoffEnd`). We must NOT add back
  // `appVacationUsed` here: doing so credited the pre-cutoff ferie, which the
  // recompute then re-subtracted → double counting.
  const vacationCarryOver = input.pdfFer.resAP;
  const vacationAccrualAdjust = round2(
    input.pdfFer.residuo - (input.pdfFer.resAP + input.appVacationAccrued)
  );
  const rolCarryOver = input.pdfRol.resAP;
  const rolAccrualAdjust = round2(
    input.pdfRol.residuo - (input.pdfRol.resAP + input.appRolAccrued)
  );
  return { vacationCarryOver, vacationAccrualAdjust, rolCarryOver, rolAccrualAdjust };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
