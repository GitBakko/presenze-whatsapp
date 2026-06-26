import { describe, it, expect } from "vitest";
import { computeLeaveBalanceFromData } from "./balance";

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
    expect(r.rolAccrued).toBe(24);
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
    expect(r.rolAccrued).toBe(14);
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
    expect(r.rolAccrued).toBeCloseTo(14.4, 2);
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
    expect(r.rolRemaining).toBe(30);
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
    expect(r.rolRemaining).toBe(20);
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
    // Jan..Aug = 8 months × 2 days = 16
    expect(r.vacationAccrued).toBe(16);
    expect(r.rolAccrued).toBe(16);
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
    expect(r.rolAccrued).toBe(24);
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
    expect(r.rolAccrued).toBeCloseTo(9.6, 2);
  });

  it("hired June, terminated August same year → 3 months (Jun,Jul,Aug)", () => {
    const r = computeLeaveBalanceFromData(
      { id: "e1", hireDate: new Date("2026-06-15"), terminationDate: new Date("2026-08-20"), contractType: "FULL_TIME", schedule: fullTimeSchedule() },
      null,
      [],
      2026,
      new Date("2026-12-31T12:00:00Z"),
    );
    // Jun..Aug = 3 months × 2 = 6
    expect(r.vacationAccrued).toBe(6);
    expect(r.rolAccrued).toBe(6);
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
    const now = new Date("2026-06-15T12:00:00"); // 6 months accrued: vac 12, rol 12
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
    // ROL: total 12, past 4 → as-of-today 8; full remaining 12−12used = 0
    expect(r.rolRemainingAsOfToday).toBe(8);
    expect(r.rolRemainingAsOfToday).toBe(
      r.rolRemaining + r.rolFutureHuman + r.rolFuturePredictor,
    );
  });
});
