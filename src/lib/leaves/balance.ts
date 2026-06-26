import { prisma } from "../db";
import { countWorkDays } from "./working-days";
import { buildWorkingScheduleMap } from "../employees/schedule-fallback";

// ── Leave type definitions ──

export const LEAVE_TYPES = {
  VACATION: { label: "Ferie", unit: "days", scalesFrom: "vacation" },
  VACATION_HALF_AM: { label: "Ferie (mattina)", unit: "days", scalesFrom: "vacation" },
  VACATION_HALF_PM: { label: "Ferie (pomeriggio)", unit: "days", scalesFrom: "vacation" },
  ROL: { label: "Permesso orario (ROL)", unit: "hours", scalesFrom: "rol" },
  SICK: { label: "Malattia", unit: "days", scalesFrom: null },
  BEREAVEMENT: { label: "Lutto", unit: "hours", scalesFrom: "rol" },
  MARRIAGE: { label: "Matrimonio", unit: "hours", scalesFrom: "rol" },
  LAW_104: { label: "L. 104", unit: "hours", scalesFrom: "rol" },
  MEDICAL_VISIT: { label: "Visita medica", unit: "hours", scalesFrom: "rol" },
} as const;

export type LeaveType = keyof typeof LEAVE_TYPES;

// ── Accrual constants (CCNL Commercio) ──

const FULL_TIME_WEEKLY_HOURS = 40;
const VACATION_DAYS_PER_MONTH_FT = 2; // 24 days/year for full-time
const ROL_HOURS_PER_MONTH_FT = 4;     // 48 hours/year for full-time

// ── Weekly hours calculation ──

interface ScheduleBlock {
  block1Start: string | null;
  block1End: string | null;
  block2Start: string | null;
  block2End: string | null;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function blockHours(block: ScheduleBlock): number {
  let minutes = 0;
  if (block.block1Start && block.block1End) {
    minutes += timeToMinutes(block.block1End) - timeToMinutes(block.block1Start);
  }
  if (block.block2Start && block.block2End) {
    minutes += timeToMinutes(block.block2End) - timeToMinutes(block.block2Start);
  }
  return minutes / 60;
}

/** Calculate total weekly hours from an employee's schedule rows */
export function calcWeeklyHours(schedule: ScheduleBlock[]): number {
  return Math.round(schedule.reduce((sum, s) => sum + blockHours(s), 0) * 10) / 10;
}

/** Calculate daily expected hours for a specific day of week */
export function calcDailyHours(_schedule: ScheduleBlock[], _dayOfWeek: number): number {
  return 0; // placeholder, overridden by calcDailyHoursFromMap
}

export function calcDailyHoursFromMap(
  scheduleMap: Map<number, ScheduleBlock>,
  dayOfWeek: number
): number {
  const day = scheduleMap.get(dayOfWeek);
  if (!day) return 0;
  return blockHours(day);
}

// ── Accrual proportioning ──

/** Get the proportioning ratio for a part-time employee */
function getProportionRatio(weeklyHours: number): number {
  if (weeklyHours >= FULL_TIME_WEEKLY_HOURS) return 1;
  return weeklyHours / FULL_TIME_WEEKLY_HOURS;
}

/** Monthly vacation accrual in days */
export function monthlyVacationAccrual(weeklyHours: number): number {
  return Math.round(VACATION_DAYS_PER_MONTH_FT * getProportionRatio(weeklyHours) * 100) / 100;
}

/** Monthly ROL accrual in hours */
export function monthlyRolAccrual(weeklyHours: number): number {
  return Math.round(ROL_HOURS_PER_MONTH_FT * getProportionRatio(weeklyHours) * 100) / 100;
}

/**
 * Months of accrual still to come in `year` AFTER the current month (the current
 * month's accrual is already in the residual), capped at the termination month.
 * `now` is injectable for deterministic tests.
 */
export function remainingAccrualMonths(now: Date, year: number, terminationDate: Date | null): number {
  if (now.getFullYear() > year) return 0;
  const curMonth = now.getFullYear() < year ? -1 : now.getMonth(); // -1 → whole future year accrues
  let endMonth = 11;
  if (terminationDate) {
    const t = new Date(terminationDate);
    if (t.getFullYear() < year) return 0;
    if (t.getFullYear() === year) endMonth = Math.min(11, t.getMonth());
  }
  return Math.max(0, endMonth - curMonth);
}

/**
 * Project a CURRENT residual forward to year-end by adding the accrual that will
 * still mature (2 ferie days + 4 ROL hours per month, pro-rated by weeklyHours).
 * Used by the amortization predictor so it spreads the WHOLE year-end monte —
 * zeroing it by 31/12 instead of leaving the future accrual unamortized.
 */
export function projectYearEndResidual(
  vacationRemaining: number,
  rolRemaining: number,
  weeklyHours: number,
  now: Date,
  year: number,
  terminationDate: Date | null,
): { vacationRemaining: number; rolRemaining: number } {
  const months = remainingAccrualMonths(now, year, terminationDate);
  return {
    vacationRemaining: Math.round((vacationRemaining + months * monthlyVacationAccrual(weeklyHours)) * 100) / 100,
    rolRemaining: Math.round((rolRemaining + months * monthlyRolAccrual(weeklyHours)) * 100) / 100,
  };
}

// ── Balance computation ──

export interface LeaveBalanceSummary {
  // Vacation (days)
  vacationAccrued: number;
  vacationAccrualAdjust: number;
  vacationUsed: number;
  vacationUsedPast: number;
  vacationFutureHuman: number;
  vacationFuturePredictor: number;
  vacationCarryOver: number;
  vacationRemaining: number;
  // Residual counting ONLY past (goduto) consumption — ignores future-approved
  // leaves (human or predictor). Drives the "progress to today" dashboard bar
  // and the per-month points of the monte trend chart.
  vacationRemainingAsOfToday: number;
  vacationUsedThisMonth: number;
  // ROL (hours)
  rolAccrued: number;
  rolAccrualAdjust: number;
  rolUsed: number;
  rolUsedPast: number;
  rolFutureHuman: number;
  rolFuturePredictor: number;
  rolCarryOver: number;
  rolRemaining: number;
  rolRemainingAsOfToday: number; // see vacationRemainingAsOfToday
  rolUsedThisMonth: number;
  // Sick
  sickDays: number;
  sickDaysThisMonth: number;
  // Weekly hours
  weeklyHours: number;
  contractType: string;
}

export interface EmployeeForBalance {
  id: string;
  hireDate: Date | null;
  terminationDate: Date | null;
  contractType: string;
  schedule: Array<ScheduleBlock & { dayOfWeek: number }>;
}

export interface BalanceAdjustments {
  vacationCarryOver: number;
  rolCarryOver: number;
  vacationAccrualAdjust: number;
  rolAccrualAdjust: number;
}

export interface ApprovedLeaveRow {
  type: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
  source?: string;
}

/**
 * Pure (no DB) compute of the leave balance from already-fetched data.
 * Use this when you have many employees' data in memory and want to
 * avoid the per-employee query waterfall. The `now` argument is
 * injectable for deterministic tests.
 */
export function computeLeaveBalanceFromData(
  employee: EmployeeForBalance,
  balance: BalanceAdjustments | null,
  approvedLeaves: ApprovedLeaveRow[],
  year: number,
  now: Date = new Date(),
): LeaveBalanceSummary {
  const weeklyHours = employee.schedule.length > 0
    ? calcWeeklyHours(employee.schedule)
    : (employee.contractType === "FULL_TIME" ? FULL_TIME_WEEKLY_HOURS : 0);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  let monthsAccrued: number;
  const hireDate = employee.hireDate ? new Date(employee.hireDate) : null;

  if (hireDate && hireDate.getFullYear() === year) {
    const hireMonth = hireDate.getMonth();
    if (year === currentYear) {
      monthsAccrued = currentMonth - hireMonth + 1;
    } else if (year < currentYear) {
      monthsAccrued = 12 - hireMonth;
    } else {
      monthsAccrued = 0;
    }
  } else if (hireDate && hireDate.getFullYear() > year) {
    monthsAccrued = 0;
  } else {
    if (year === currentYear) {
      monthsAccrued = currentMonth + 1;
    } else if (year < currentYear) {
      monthsAccrued = 12;
    } else {
      monthsAccrued = 0;
    }
  }

  // ── Termination ceiling (cap upper month at termination month, inclusive) ──
  // Uses the SAME local-Date convention as hireDate above
  // (new Date(...).getFullYear()/getMonth()).
  if (employee.terminationDate) {
    const term = new Date(employee.terminationDate);
    const termYear = term.getFullYear();
    const termMonth = term.getMonth();
    if (termYear < year) {
      monthsAccrued = 0;
    } else if (termYear === year) {
      // effectiveEndMonth = the last month currently counted for this year:
      // currentMonth if computing the running year, else December (11).
      const effectiveEndMonth = year === currentYear ? currentMonth : 11;
      if (termMonth < effectiveEndMonth) {
        monthsAccrued -= effectiveEndMonth - termMonth;
      }
    }
  }

  monthsAccrued = Math.max(0, Math.min(12, monthsAccrued));

  const vacationAccrued = Math.round(monthsAccrued * monthlyVacationAccrual(weeklyHours) * 100) / 100;
  const rolAccrued = Math.round(monthsAccrued * monthlyRolAccrual(weeklyHours) * 100) / 100;

  const vacationCarryOver = balance?.vacationCarryOver ?? 0;
  const rolCarryOver = balance?.rolCarryOver ?? 0;
  const vacationAccrualAdjust = balance?.vacationAccrualAdjust ?? 0;
  const rolAccrualAdjust = balance?.rolAccrualAdjust ?? 0;

  const monthStart = `${year}-${String(currentMonth + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(currentMonth + 1).padStart(2, "0")}-31`;

  // Working-day map keyed by the days the employee ACTUALLY works: real rows are
  // kept only when they carry work hours (a stray empty Sat/Sun row must NOT make
  // the weekend count toward ferie), and schedule-less FULL_TIME falls back to
  // Mon-Fri — same rule the leave popup (api/leaves/preview-days) uses.
  const scheduleMap = buildWorkingScheduleMap(employee.schedule, employee.contractType);

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  let vacationUsed = 0;
  let vacationUsedThisMonth = 0;
  let vacationUsedPast = 0;
  let vacationFutureHuman = 0;
  let vacationFuturePredictor = 0;
  let rolUsed = 0;
  let rolUsedThisMonth = 0;
  let rolUsedPast = 0;
  let rolFutureHuman = 0;
  let rolFuturePredictor = 0;
  let sickDays = 0;
  let sickDaysThisMonth = 0;

  for (const leave of approvedLeaves) {
    const type = leave.type as LeaveType;
    const isThisMonth = leave.startDate >= monthStart && leave.startDate <= monthEnd;
    const isPredictor = leave.source === "PREDICTOR";

    if (type === "VACATION") {
      const days = countWorkDays(leave.startDate, leave.endDate, scheduleMap);
      vacationUsed += days;
      if (isThisMonth) vacationUsedThisMonth += days;
      // Past = working days with date ≤ today; future = the remainder.
      let pastDays = 0;
      if (leave.startDate <= today) {
        const upper = leave.endDate <= today ? leave.endDate : today;
        pastDays = countWorkDays(leave.startDate, upper, scheduleMap);
      }
      const futureDays = Math.round((days - pastDays) * 100) / 100;
      vacationUsedPast += pastDays;
      if (isPredictor) vacationFuturePredictor += futureDays;
      else vacationFutureHuman += futureDays;
    } else if (type === "VACATION_HALF_AM" || type === "VACATION_HALF_PM") {
      vacationUsed += 0.5;
      if (isThisMonth) vacationUsedThisMonth += 0.5;
      if (leave.startDate <= today) vacationUsedPast += 0.5;
      else if (isPredictor) vacationFuturePredictor += 0.5;
      else vacationFutureHuman += 0.5;
    } else if (type === "SICK") {
      const days = countCalendarDays(leave.startDate, leave.endDate);
      sickDays += days;
      if (isThisMonth) sickDaysThisMonth += days;
    } else {
      const hours = leave.hours ?? 0;
      rolUsed += hours;
      if (isThisMonth) rolUsedThisMonth += hours;
      if (leave.startDate <= today) rolUsedPast += hours;
      else if (isPredictor) rolFuturePredictor += hours;
      else rolFutureHuman += hours;
    }
  }

  return {
    vacationAccrued,
    vacationAccrualAdjust,
    vacationUsed: Math.round(vacationUsed * 100) / 100,
    vacationUsedPast: Math.round(vacationUsedPast * 100) / 100,
    vacationFutureHuman: Math.round(vacationFutureHuman * 100) / 100,
    vacationFuturePredictor: Math.round(vacationFuturePredictor * 100) / 100,
    vacationCarryOver,
    vacationRemaining:
      Math.round(
        (vacationCarryOver + vacationAccrued + vacationAccrualAdjust - vacationUsed) * 100
      ) / 100,
    vacationRemainingAsOfToday:
      Math.round(
        (vacationCarryOver + vacationAccrued + vacationAccrualAdjust - vacationUsedPast) * 100
      ) / 100,
    vacationUsedThisMonth: Math.round(vacationUsedThisMonth * 100) / 100,
    rolAccrued,
    rolAccrualAdjust,
    rolUsed: Math.round(rolUsed * 100) / 100,
    rolUsedPast: Math.round(rolUsedPast * 100) / 100,
    rolFutureHuman: Math.round(rolFutureHuman * 100) / 100,
    rolFuturePredictor: Math.round(rolFuturePredictor * 100) / 100,
    rolCarryOver,
    rolRemaining:
      Math.round(
        (rolCarryOver + rolAccrued + rolAccrualAdjust - rolUsed) * 100
      ) / 100,
    rolRemainingAsOfToday:
      Math.round(
        (rolCarryOver + rolAccrued + rolAccrualAdjust - rolUsedPast) * 100
      ) / 100,
    rolUsedThisMonth: Math.round(rolUsedThisMonth * 100) / 100,
    sickDays,
    sickDaysThisMonth,
    weeklyHours,
    contractType: employee.contractType,
  };
}

/**
 * Compute the full leave balance for an employee for a given year.
 * Calculates accrual based on hireDate and schedule, then subtracts used from approved requests.
 */
export async function computeLeaveBalance(
  employeeId: string,
  year: number
): Promise<LeaveBalanceSummary> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { schedule: true },
  });

  if (!employee) {
    throw new Error("Dipendente non trovato");
  }

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [balance, approvedLeaves] = await Promise.all([
    prisma.leaveBalance.findUnique({
      where: { employeeId_year: { employeeId, year } },
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: "APPROVED",
        startDate: { gte: yearStart, lte: yearEnd },
      },
    }),
  ]);

  return computeLeaveBalanceFromData(
    {
      id: employee.id,
      hireDate: employee.hireDate,
      terminationDate: employee.terminationDate,
      contractType: employee.contractType,
      schedule: employee.schedule,
    },
    balance,
    approvedLeaves,
    year,
  );
}

// ── Helpers ──

/** Count calendar days between two dates (inclusive) */
function countCalendarDays(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Check if a given date is covered by an approved leave for the employee.
 * Returns the leave type or null.
 */
export async function getLeaveForDate(
  employeeId: string,
  date: string
): Promise<{ type: LeaveType; hours?: number; timeSlots?: { from: string; to: string }[] } | null> {
  const leave = await prisma.leaveRequest.findFirst({
    where: {
      employeeId,
      status: "APPROVED",
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });

  if (!leave) return null;

  return {
    type: leave.type as LeaveType,
    hours: leave.hours ?? undefined,
    timeSlots: leave.timeSlots ? JSON.parse(leave.timeSlots) : undefined,
  };
}
