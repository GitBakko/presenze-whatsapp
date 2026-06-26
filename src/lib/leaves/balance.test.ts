import { describe, it, expect } from "vitest";
import {
  computeLeaveBalanceFromData,
  remainingAccrualMonths,
  projectYearEndResidual,
  parsePayrollMonthLabel,
} from "./balance";

type ScheduleRow = {
  dayOfWeek: number;
  block1Start: string | null;
  block1End: string | null;
  block2Start: string | null;
  block2End: string | null;
};

function fullTimeSchedule(): ScheduleRow[] {
  return [1, 2, 3, 4, 5].map((dow) => ({
    dayOfWeek: dow,
    block1Start: "09:00",
    block1End: "13:00",
    block2Start: "14:00",
    block2End: "18:00",
  }));
}

function partTimeSchedule24h(): ScheduleRow[] {
  return [1, 2, 3].map((dow) => ({
    dayOfWeek: dow,
    block1Start: "09:00",
    block1End: "13:00",
    block2Start: "14:00",
    block2End: "18:00",
  }));
}

describe("computeLeaveBalanceFromData", () => {
  it("FULL_TIME hired before this year, no leaves, no balance → 12 months accrued at year end", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: null, contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationAccrued).toBe(24);
    expect(r.rolAccrued).toBe(48);
    expect(r.vacationUsed).toBe(0);
    expect(r.rolUsed).toBe(0);
    expect(r.vacationCarryOver).toBe(0);
    expect(r.weeklyHours).toBe(40);
  });

  it("FULL_TIME hired June this year, now=December same year → 7 months accrued", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2026-06-15"), terminationDate: null, contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationAccrued).toBe(14);
    expect(r.rolAccrued).toBe(28);
  });

  it("PART_TIME 24h/wk with schedule rows → accrual proportional to 24/40", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e2", hireDate: new Date("2020-01-01"), terminationDate: null, contractType: "PART_TIME", schedule: partTimeSchedule24h() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.weeklyHours).toBe(24);
    expect(r.vacationAccrued).toBeCloseTo(14.4, 2);
    expect(r.rolAccrued).toBeCloseTo(28.8, 2);
  });

  it("PART_TIME without schedule rows → accrual=0, no throw (known limitation)", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e3", hireDate: new Date("2020-01-01"), terminationDate: null, contractType: "PART_TIME", schedule: [] },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.weeklyHours).toBe(0);
    expect(r.vacationAccrued).toBe(0);
    expect(r.rolAccrued).toBe(0);
  });

  it("Hired previous year with carryOver=10 and accrualAdjust=+2 → totals include both", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: null, contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      {
        vacationCarryOver: 10,
        rolCarryOver: 5,
        vacationAccrualAdjust: 2,
        rolAccrualAdjust: 1,
      },
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationCarryOver).toBe(10);
    expect(r.vacationAccrualAdjust).toBe(2);
    expect(r.vacationRemaining).toBe(36);
    expect(r.rolRemaining).toBe(54);
  });

  it("1 leave VACATION 5 working-days APPROVED → vacationUsed=5", () => {
    // Use 2026-06-08..2026-06-12 (Mon-Fri, no Italian holidays).
    // 2026-06-01..06-05 would hit Festa della Repubblica on Jun 2.
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: null, contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [{
        type: "VACATION",
        startDate: "2026-06-08",
        endDate: "2026-06-12",
        hours: null,
        timeSlots: null,
      }],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationUsed).toBe(5);
    expect(r.vacationRemaining).toBe(19);
  });

  it("FULL_TIME WITHOUT schedule rows → VACATION Fri-Sun counts 1 working day via Mon-Fri fallback", () => {
    // Regression: schedule-less FULL_TIME employees (the majority in prod) used to
    // scale 0 vacation days here while the leave popup reported the Mon-Fri count.
    // 2026-06-12 Fri .. 2026-06-14 Sun → only Fri is a working day.
    const r = computeLeaveBalanceFromData(
      { id: "e9", hireDate: new Date("2020-01-01"), terminationDate: null, contractType: "FULL_TIME", schedule: [] },
      null,
      [{
        type: "VACATION",
        startDate: "2026-06-12",
        endDate: "2026-06-14",
        hours: null,
        timeSlots: null,
      }],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationUsed).toBe(1);
  });

  it("1 leave ROL hours=4 APPROVED → rolUsed=4", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: null, contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [{
        type: "ROL",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hours: 4,
        timeSlots: null,
      }],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.rolUsed).toBe(4);
    expect(r.rolRemaining).toBe(44);
  });

  it("VACATION_HALF_AM counted as 0.5 days", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: null, contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [{
        type: "VACATION_HALF_AM",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        hours: null,
        timeSlots: '[{"from":"09:00","to":"13:00"}]',
      }],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationUsed).toBe(0.5);
  });

  it("terminated in this year (Aug) → accrual capped at termination month inclusive (8 months)", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    // Jan..Aug = 8 months × 2 days = 16; ROL = 8 × 4h = 32
    expect(r.vacationAccrued).toBe(16);
    expect(r.rolAccrued).toBe(32);
  });

  it("year after termination → 0 months accrued", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [],
      2027,
      new Date("2027-12-31T12:00:00Z"),
    );
    expect(r.vacationAccrued).toBe(0);
    expect(r.rolAccrued).toBe(0);
  });

  it("year before termination → unchanged (full 12 months)", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [],
      2025,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.vacationAccrued).toBe(24);
    expect(r.rolAccrued).toBe(48);
  });

  it("part-time terminated mid-year → cap AND proportion both apply", () => {
    // PART_TIME 24h/wk, terminated Aug 2026 → 8 months × (24/40 × 2 days) = 8 × 1.2 = 9.6
    const r = computeLeaveBalanceFromData(
      { id: "e2", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "PART_TIME", schedule: partTimeSchedule24h() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    expect(r.weeklyHours).toBe(24);
    expect(r.vacationAccrued).toBeCloseTo(9.6, 2);
    expect(r.rolAccrued).toBeCloseTo(19.2, 2);
  });

  it("hired June, terminated August same year → 3 months (Jun,Jul,Aug)", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2026-06-15"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    // Jun..Aug = 3 months × 2 = 6; ROL = 3 × 4h = 12
    expect(r.vacationAccrued).toBe(6);
    expect(r.rolAccrued).toBe(12);
  });

  it("adjust fields still added on top of capped accrual", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2020-01-01"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      { vacationCarryOver: 0, rolCarryOver: 0, vacationAccrualAdjust: 2, rolAccrualAdjust: 1 },
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    // 16 accrued + 2 adjust − 0 used = 18 remaining
    expect(r.vacationAccrued).toBe(16);
    expect(r.vacationRemaining).toBe(18);
  });
});

describe("computeLeaveBalanceFromData — past/future/predictor split", () => {
  const emp = {
    id: "e1",
    hireDate: new Date("2020-01-01"),
    terminationDate: null,
    contractType: "FULL_TIME",
    schedule: fullTimeSchedule(),
  };

  it("splits vacation into past vs future-human vs future-predictor", () => {
    const now = new Date("2026-06-15T12:00:00");
    const leaves = [
      { type: "VACATION", startDate: "2026-03-02", endDate: "2026-03-03", hours: null, timeSlots: null, source: "MANAGER" }, // 2 wd past
      { type: "VACATION", startDate: "2026-09-07", endDate: "2026-09-08", hours: null, timeSlots: null, source: "MANAGER" }, // 2 wd future human
      { type: "VACATION", startDate: "2026-10-05", endDate: "2026-10-05", hours: null, timeSlots: null, source: "PREDICTOR" }, // 1 wd future predictor
    ];
    const r = computeLeaveBalanceFromData(emp, null, leaves, 2026, now);
    expect(r.vacationUsedPast).toBe(2);
    expect(r.vacationFutureHuman).toBe(2);
    expect(r.vacationFuturePredictor).toBe(1);
    expect(r.vacationUsed).toBe(5);
    expect(r.vacationUsedPast + r.vacationFutureHuman + r.vacationFuturePredictor).toBe(r.vacationUsed);
  });

  it("splits a vacation spanning today into past + future portions", () => {
    const now = new Date("2026-06-15T12:00:00"); // Mon
    const leaves = [
      { type: "VACATION", startDate: "2026-06-11", endDate: "2026-06-18", hours: null, timeSlots: null, source: "MANAGER" },
    ];
    const r = computeLeaveBalanceFromData(emp, null, leaves, 2026, now);
    // working days 11(Thu),12(Fri),15(Mon today→past) = 3 past; 16,17,18 = 3 future
    expect(r.vacationUsedPast).toBe(3);
    expect(r.vacationFutureHuman).toBe(3);
    expect(r.vacationUsed).toBe(6);
  });

  it("splits ROL hours by startDate and source", () => {
    const now = new Date("2026-06-15T12:00:00");
    const leaves = [
      { type: "ROL", startDate: "2026-05-04", endDate: "2026-05-04", hours: 4, timeSlots: null, source: "MANAGER" }, // past
      { type: "ROL", startDate: "2026-08-04", endDate: "2026-08-04", hours: 8, timeSlots: null, source: "PREDICTOR" }, // future predictor
    ];
    const r = computeLeaveBalanceFromData(emp, null, leaves, 2026, now);
    expect(r.rolUsedPast).toBe(4);
    expect(r.rolFuturePredictor).toBe(8);
    expect(r.rolFutureHuman).toBe(0);
    expect(r.rolUsed).toBe(12);
  });

  it("schedule-less FULL_TIME: a Mon→Sun vacation counts 5 working days, NOT 7 calendar days", () => {
    // Repro of the prod report: Stefano Brunelli, FULL_TIME, no EmployeeSchedule
    // rows, VACATION 2026-08-24 (Mon) → 2026-08-30 (Sun). The monte must drop by
    // 5 (working days), never 7 (calendar days incl. Sat 29 + Sun 30).
    const scheduleLess = {
      id: "e1", hireDate: new Date("2020-01-01"), terminationDate: null,
      contractType: "FULL_TIME", schedule: [] as ScheduleRow[],
    };
    const leaves = [
      { type: "VACATION", startDate: "2026-08-24", endDate: "2026-08-30", hours: null, timeSlots: null, source: "MANAGER" },
    ];
    const r = computeLeaveBalanceFromData(scheduleLess, null, leaves, 2026, new Date("2026-12-31T12:00:00"));
    expect(r.vacationUsed).toBe(5);
  });

  it("empty (all-null) weekend schedule rows do NOT count toward a Mon→Sun vacation", () => {
    // The other prod scenario: the employee has Mon-Fri rows WITH hours plus stray
    // Sat(6)/Sun(7) rows with no work blocks. Those empty rows must not turn the
    // weekend into working days → 5, not 7.
    const withEmptyWeekend = {
      id: "e1", hireDate: new Date("2020-01-01"), terminationDate: null,
      contractType: "FULL_TIME",
      schedule: [
        ...fullTimeSchedule(), // 1..5 with blocks
        { dayOfWeek: 6, block1Start: null, block1End: null, block2Start: null, block2End: null },
        { dayOfWeek: 7, block1Start: null, block1End: null, block2Start: null, block2End: null },
      ] as ScheduleRow[],
    };
    const leaves = [
      { type: "VACATION", startDate: "2026-08-24", endDate: "2026-08-30", hours: null, timeSlots: null, source: "MANAGER" },
    ];
    const r = computeLeaveBalanceFromData(withEmptyWeekend, null, leaves, 2026, new Date("2026-12-31T12:00:00"));
    expect(r.vacationUsed).toBe(5);
  });

  it("a real Saturday worker (Sat row WITH hours) DOES count Saturday", () => {
    // Guard against over-correction: if Saturday genuinely carries work hours it
    // must still count. Mon-Sat worker on a Mon→Sun vacation = 6 working days.
    const monSat = {
      id: "e1", hireDate: new Date("2020-01-01"), terminationDate: null,
      contractType: "FULL_TIME",
      schedule: [
        ...fullTimeSchedule(),
        { dayOfWeek: 6, block1Start: "09:00", block1End: "13:00", block2Start: null, block2End: null },
      ] as ScheduleRow[],
    };
    const leaves = [
      { type: "VACATION", startDate: "2026-08-24", endDate: "2026-08-30", hours: null, timeSlots: null, source: "MANAGER" },
    ];
    const r = computeLeaveBalanceFromData(monSat, null, leaves, 2026, new Date("2026-12-31T12:00:00"));
    expect(r.vacationUsed).toBe(6);
  });

  it("as-of-today residual ignores future-approved leaves (= remaining + future)", () => {
    const now = new Date("2026-06-15T12:00:00"); // 6 months accrued: vac 12, rol 24
    const leaves = [
      { type: "VACATION", startDate: "2026-03-02", endDate: "2026-03-03", hours: null, timeSlots: null, source: "MANAGER" }, // 2 wd past
      { type: "VACATION", startDate: "2026-09-07", endDate: "2026-09-08", hours: null, timeSlots: null, source: "MANAGER" }, // 2 wd future human
      { type: "VACATION", startDate: "2026-10-05", endDate: "2026-10-05", hours: null, timeSlots: null, source: "PREDICTOR" }, // 1 wd future predictor
      { type: "ROL", startDate: "2026-05-04", endDate: "2026-05-04", hours: 4, timeSlots: null, source: "MANAGER" }, // 4h past
      { type: "ROL", startDate: "2026-08-04", endDate: "2026-08-04", hours: 8, timeSlots: null, source: "PREDICTOR" }, // 8h future predictor
    ];
    const r = computeLeaveBalanceFromData(emp, null, leaves, 2026, now);
    // Vacation: total 12, past 2 → as-of-today 10; full remaining 12−5used = 7
    expect(r.vacationRemainingAsOfToday).toBe(10);
    expect(r.vacationRemainingAsOfToday).toBe(
      r.vacationRemaining + r.vacationFutureHuman + r.vacationFuturePredictor,
    );
    // ROL: accrued 24, past 4 → as-of-today 20; full remaining 24−12used = 12
    expect(r.rolRemainingAsOfToday).toBe(20);
    expect(r.rolRemainingAsOfToday).toBe(
      r.rolRemaining + r.rolFutureHuman + r.rolFuturePredictor,
    );
  });
});

describe("remainingAccrualMonths", () => {
  it("counts the months still to accrue AFTER the current month", () => {
    // now = Jun (already accrued) → Jul..Dec still to come = 6.
    expect(remainingAccrualMonths(new Date("2026-06-15T12:00:00"), 2026, null)).toBe(6);
  });

  it("December → nothing left to accrue this year", () => {
    expect(remainingAccrualMonths(new Date("2026-12-31T12:00:00"), 2026, null)).toBe(0);
  });

  it("a past year (now after the year) → 0", () => {
    expect(remainingAccrualMonths(new Date("2027-03-01T12:00:00"), 2026, null)).toBe(0);
  });

  it("planning a future year (now before it) → full 12 months", () => {
    expect(remainingAccrualMonths(new Date("2026-06-15T12:00:00"), 2027, null)).toBe(12);
  });

  it("termination caps the end month (Aug term, now Jun → Jul..Aug = 2)", () => {
    expect(remainingAccrualMonths(new Date("2026-06-15T12:00:00"), 2026, new Date("2026-08-20"))).toBe(2);
  });

  it("termination before the year → 0", () => {
    expect(remainingAccrualMonths(new Date("2026-06-15T12:00:00"), 2026, new Date("2025-08-20"))).toBe(0);
  });
});

describe("projectYearEndResidual", () => {
  it("adds the FULL_TIME accrual still to come (2 ferie + 4 ROL h per month)", () => {
    // now Jun, 6 months left → vac +12, rol +24.
    const p = projectYearEndResidual(10, 5, 40, new Date("2026-06-15T12:00:00"), 2026, null);
    expect(p.vacationRemaining).toBe(22); // 10 + 6×2
    expect(p.rolRemaining).toBe(29); // 5 + 6×4
  });

  it("PART_TIME 24h/wk pro-rates the accrual (×0.6)", () => {
    // 6 months left → vac +6×1.2=7.2, rol +6×2.4=14.4.
    const p = projectYearEndResidual(0, 0, 24, new Date("2026-06-15T12:00:00"), 2026, null);
    expect(p.vacationRemaining).toBeCloseTo(7.2, 2);
    expect(p.rolRemaining).toBeCloseTo(14.4, 2);
  });

  it("in December the residual is returned unchanged (no months left)", () => {
    const p = projectYearEndResidual(8, 3, 40, new Date("2026-12-31T12:00:00"), 2026, null);
    expect(p.vacationRemaining).toBe(8);
    expect(p.rolRemaining).toBe(3);
  });
});

describe("parsePayrollMonthLabel", () => {
  it("maps an Italian month label to its number", () => {
    expect(parsePayrollMonthLabel("Maggio 2026")).toBe(5);
    expect(parsePayrollMonthLabel("gennaio 2026")).toBe(1);
    expect(parsePayrollMonthLabel("Dicembre 2025")).toBe(12);
  });
  it("returns null for an unrecognised label", () => {
    expect(parsePayrollMonthLabel("Foo 2026")).toBeNull();
    expect(parsePayrollMonthLabel("")).toBeNull();
  });
});

describe("payroll cutoff — carico commercialista già ingloba le ferie pregresse", () => {
  const ft = {
    id: "stef", hireDate: new Date("2020-01-01"), terminationDate: null,
    contractType: "FULL_TIME", schedule: fullTimeSchedule(),
  };
  // Stefano (prod): carico Maggio 2026 → residuo 31,82 ⇒ carryOver 22,65 + adjust −2,83.
  const bal = { vacationCarryOver: 22.65, rolCarryOver: 0, vacationAccrualAdjust: -2.83, rolAccrualAdjust: 0 };
  const leaves = [
    { type: "VACATION", startDate: "2026-05-08", endDate: "2026-05-08", hours: null, timeSlots: null, source: "MANAGER" }, // ≤ taglio
    { type: "VACATION", startDate: "2026-05-29", endDate: "2026-05-29", hours: null, timeSlots: null, source: "MANAGER" }, // ≤ taglio
    { type: "VACATION", startDate: "2026-06-12", endDate: "2026-06-12", hours: null, timeSlots: null, source: "MANAGER" }, // > taglio
    { type: "VACATION", startDate: "2026-08-24", endDate: "2026-08-30", hours: null, timeSlots: null, source: "MANAGER" }, // > taglio (5 gg lav.)
  ];
  const now = new Date("2026-06-26T12:00:00"); // accrued = 6 mesi × 2 = 12

  it("con taglio fine maggio: conta SOLO le ferie dopo maggio (no doppio conteggio)", () => {
    const r = computeLeaveBalanceFromData(ft, bal, leaves, 2026, now, "2026-05-31");
    expect(r.vacationUsed).toBe(6); // 12 giu (1) + 24-30 ago (5); 8 e 29 maggio sono nel carico
    expect(r.vacationRemaining).toBe(25.82); // 22,65 + 12 − 2,83 − 6
  });

  it("senza taglio (null): conta tutte le ferie dell'anno (retro-compatibile)", () => {
    const r = computeLeaveBalanceFromData(ft, bal, leaves, 2026, now, null);
    expect(r.vacationUsed).toBe(8); // include anche 8 e 29 maggio
    expect(r.vacationRemaining).toBe(23.82);
  });

  it("il taglio esclude anche i permessi ROL ≤ taglio ma NON la malattia", () => {
    const rolLeaves = [
      { type: "ROL", startDate: "2026-04-10", endDate: "2026-04-10", hours: 3, timeSlots: null, source: "MANAGER" }, // ≤ taglio
      { type: "ROL", startDate: "2026-06-04", endDate: "2026-06-04", hours: 2, timeSlots: null, source: "MANAGER" }, // > taglio
      { type: "SICK", startDate: "2026-03-02", endDate: "2026-03-04", hours: null, timeSlots: null, source: "MANAGER" }, // ≤ taglio ma malattia
    ];
    const r = computeLeaveBalanceFromData(ft, bal, rolLeaves, 2026, now, "2026-05-31");
    expect(r.rolUsed).toBe(2); // solo il ROL di giugno; aprile è nel carico
    expect(r.sickDays).toBe(3); // malattia sempre conteggiata (non fa parte del carico ferie/permessi)
  });
});
