import type { Prisma } from "@prisma/client";
import { todayRome } from "@/lib/tz";

/**
 * Inclusive of both endpoints: active on day D iff hired on/before D and
 * not terminated before D. `dateIso` is "YYYY-MM-DD".
 *
 * terminationDate is the employee's INCLUSIVE last active day:
 * active on D iff D <= terminationDate.
 */
export function isActiveOn(
  emp: { hireDate: Date | null; terminationDate: Date | null },
  dateIso: string,
): boolean {
  if (emp.hireDate && todayRome(emp.hireDate) > dateIso) return false;
  if (emp.terminationDate && todayRome(emp.terminationDate) < dateIso) return false;
  return true;
}

/**
 * Prisma where-fragment for list endpoints (D = today or period-end).
 * Filters relative to the period date D — never a global
 * `{ terminationDate: null }` (which would break historical reports).
 */
export function activeOnWhere(dateIso: string): Prisma.EmployeeWhereInput {
  return {
    AND: [
      { OR: [{ hireDate: null }, { hireDate: { lte: new Date(`${dateIso}T23:59:59.999Z`) } }] },
      { OR: [{ terminationDate: null }, { terminationDate: { gte: new Date(`${dateIso}T00:00:00.000Z`) } }] },
    ],
  };
}
