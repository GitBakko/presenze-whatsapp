import { todayRome } from "@/lib/tz";

export const TERMINATION_REASONS = ["RESIGNATION", "DISMISSAL", "OTHER"] as const;
export type TerminationReason = (typeof TERMINATION_REASONS)[number];

export interface TerminationInput {
  terminationDate: string; // "YYYY-MM-DD"
  reason: TerminationReason;
  note?: string;
}

export interface EmployeeForTermination {
  id: string;
  hireDate: Date | null;
  nfcUid: string | null;
  telegramChatId: string | null;
}

export interface TerminationLeaveRow {
  status: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
}

export interface TerminationUpdateData {
  terminationDate: Date;
  terminationReason: string;
  terminatedById: string;
  terminatedAt: Date;
  nfcUid: null;
  telegramChatId: null;
}

export interface TerminationPlan {
  updateData: TerminationUpdateData;
  warnings: string[];
}

/**
 * Pure: validate + build the Prisma update payload for terminating an
 * employee. Frees nfcUid + telegramChatId for reuse. Throws on invalid
 * input (bad date format, reason, or terminationDate < hireDate).
 */
export function planTermination(
  employee: EmployeeForTermination,
  input: TerminationInput,
  actorUserId: string,
  now: Date = new Date(),
  leaves: TerminationLeaveRow[] = [],
): TerminationPlan {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.terminationDate)) {
    throw new Error("Formato terminationDate non valido (YYYY-MM-DD)");
  }
  if (!TERMINATION_REASONS.includes(input.reason)) {
    throw new Error("Motivo (reason) non valido: usa RESIGNATION, DISMISSAL o OTHER");
  }
  if (employee.hireDate && todayRome(employee.hireDate) > input.terminationDate) {
    throw new Error("terminationDate non puo' precedere la data di assunzione (hireDate)");
  }

  const reason = input.note?.trim()
    ? `${input.reason}: ${input.note.trim()}`
    : input.reason;

  const warnings: string[] = [];
  for (const l of leaves) {
    if ((l.status === "APPROVED" || l.status === "PENDING") && l.endDate > input.terminationDate) {
      warnings.push(
        `Richiesta ${l.status} dal ${l.startDate} al ${l.endDate} oltre la data di cessazione (${input.terminationDate})`,
      );
    }
  }

  return {
    updateData: {
      terminationDate: new Date(input.terminationDate),
      terminationReason: reason,
      terminatedById: actorUserId,
      terminatedAt: now,
      nfcUid: null,
      telegramChatId: null,
    },
    warnings,
  };
}

/**
 * True iff the employee is terminated as-of `dateIso` (strictly past the
 * inclusive last active day). Mirror of !isActiveOn for the term ceiling.
 */
export function isTerminatedOnDate(termDate: Date | null, dateIso: string): boolean {
  if (!termDate) return false;
  return todayRome(termDate) < dateIso;
}
