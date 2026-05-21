/**
 * Back-compat shim. parseLeaveDates moved to src/lib/leaves/validation.ts
 * with a new discriminated-union return type and a required refDate arg.
 *
 * Direct callers of the legacy signature must be migrated to the new
 * `parseLeaveDates(input, refDate)` from `@/lib/leaves/validation`.
 */
export { formatItDate } from "./leaves/format";
export { parseLeaveDates } from "./leaves/validation";
