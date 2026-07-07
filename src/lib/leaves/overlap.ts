/**
 * Overlap detection across all leave creation paths.
 *
 * `classifyOverlap` is pure (no Prisma) — feed it the new request and
 * the list of existing intersecting leaves. `checkOverlap` is the
 * convenience wrapper that runs the Prisma query + classifier.
 */
import { prisma } from "../db";

export type OverlapKind = "BLOCK" | "REQUIRES_CONFIRM" | "OK";

export interface ExistingLeaveConflict {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: string | null;
  overlappingDays: string[];
}

export interface NewLeaveCandidate {
  type: string;
  startDate: string;
  endDate: string;
  hours?: number | null;
  timeSlots?: string | null;
}

export interface OverlapResult {
  kind: OverlapKind;
  conflicts: ExistingLeaveConflict[];
  reason?: string;
}

const ONE_OFF_TYPES = new Set(["BEREAVEMENT", "MARRIAGE", "LAW_104", "MEDICAL_VISIT"]);

function isVacationFull(type: string): boolean {
  return type === "VACATION";
}

function isVacationHalfAM(type: string): boolean {
  return type === "VACATION_HALF_AM";
}

function isVacationHalfPM(type: string): boolean {
  return type === "VACATION_HALF_PM";
}

function parseSlots(json: string | null | undefined): Array<{ from: string; to: string }> {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

function slotsOverlap(a: Array<{ from: string; to: string }>, b: Array<{ from: string; to: string }>): boolean {
  for (const x of a) for (const y of b) {
    if (x.from < y.to && y.from < x.to) return true;
  }
  return false;
}

function classifyPair(neu: NewLeaveCandidate, existing: ExistingLeaveConflict): OverlapKind {
  const e = existing.type;
  const n = neu.type;

  // SICK arriving over non-SICK APPROVED → admin confirms.
  if (n === "SICK" && e !== "SICK" && existing.status === "APPROVED") {
    return "REQUIRES_CONFIRM";
  }

  // SICK over SICK → BLOCK (dedup).
  if (n === "SICK" && e === "SICK") return "BLOCK";

  // VACATION/ROL/etc arriving on a day already SICK → BLOCK.
  if (e === "SICK" && n !== "SICK") return "BLOCK";

  // One-off events block anything else intersecting.
  if (ONE_OFF_TYPES.has(e) || ONE_OFF_TYPES.has(n)) return "BLOCK";

  // VACATION-family vs VACATION-family same day(s).
  const eIsVacation = isVacationFull(e) || isVacationHalfAM(e) || isVacationHalfPM(e);
  const nIsVacation = isVacationFull(n) || isVacationHalfAM(n) || isVacationHalfPM(n);
  if (eIsVacation && nIsVacation) {
    if ((isVacationHalfAM(e) && isVacationHalfPM(n)) || (isVacationHalfPM(e) && isVacationHalfAM(n))) {
      return "OK";
    }
    return "BLOCK";
  }

  // VACATION (full) + ROL same day → BLOCK.
  if (isVacationFull(e) && n === "ROL") return "BLOCK";
  if (isVacationFull(n) && e === "ROL") return "BLOCK";

  // VACATION_HALF + ROL — OK (conservative, half-day is enforced separately).
  if ((isVacationHalfAM(e) || isVacationHalfPM(e)) && n === "ROL") return "OK";
  if ((isVacationHalfAM(n) || isVacationHalfPM(n)) && e === "ROL") return "OK";

  // ROL + ROL — check timeSlots intersection.
  if (e === "ROL" && n === "ROL") {
    const aSlots = parseSlots(neu.timeSlots);
    const bSlots = parseSlots(existing.timeSlots);
    if (aSlots.length === 0 || bSlots.length === 0) return "BLOCK";
    return slotsOverlap(aSlots, bSlots) ? "BLOCK" : "OK";
  }

  return "BLOCK";
}

export function classifyOverlap(neu: NewLeaveCandidate, existing: ExistingLeaveConflict[]): OverlapResult {
  if (existing.length === 0) return { kind: "OK", conflicts: [] };

  let worst: OverlapKind = "OK";
  for (const ex of existing) {
    const verdict = classifyPair(neu, ex);
    if (verdict === "BLOCK") { worst = "BLOCK"; break; }
    if (verdict === "REQUIRES_CONFIRM") worst = "REQUIRES_CONFIRM";
  }

  return {
    kind: worst,
    conflicts: existing,
    reason: worst === "BLOCK"
      ? `Conflitto con richiesta esistente (${existing[0].type} ${existing[0].startDate}-${existing[0].endDate})`
      : undefined,
  };
}

export async function checkOverlap(
  employeeId: string,
  request: NewLeaveCandidate,
  options: { excludeId?: string } = {}
): Promise<OverlapResult> {
  const rows = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ["APPROVED", "PENDING"] },
      // Predictor-generated days are soft proposals: they never block a human
      // request — the request supersedes them (see supersedePredictorLeaves).
      source: { not: "PREDICTOR" },
      startDate: { lte: request.endDate },
      endDate: { gte: request.startDate },
      ...(options.excludeId ? { NOT: { id: options.excludeId } } : {}),
    },
  });

  const existing: ExistingLeaveConflict[] = rows.map(r => ({
    id: r.id,
    type: r.type,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    hours: r.hours ?? null,
    timeSlots: r.timeSlots ?? null,
    overlappingDays: [],
  }));

  return classifyOverlap(request, existing);
}

/**
 * A human leave request always supersedes predictor-generated days (confirmed
 * or not): call this right before persisting the request to delete every
 * predictor day intersecting its range. Pass `db` when inside a transaction.
 */
export async function supersedePredictorLeaves(
  employeeId: string,
  startDate: string,
  endDate: string,
  options: { excludeId?: string; db?: { leaveRequest: Pick<typeof prisma.leaveRequest, "deleteMany"> } } = {},
): Promise<number> {
  const db = options.db ?? prisma;
  const res = await db.leaveRequest.deleteMany({
    where: {
      employeeId,
      source: "PREDICTOR",
      startDate: { lte: endDate },
      endDate: { gte: startDate },
      ...(options.excludeId ? { NOT: { id: options.excludeId } } : {}),
    },
  });
  return res.count;
}
