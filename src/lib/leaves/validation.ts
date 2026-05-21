/**
 * Input validation + parsing for the leaves domain.
 *
 * Consolidates the old `leave-date-parser.ts` with type detection from
 * email subject and Zod schemas for create/edit payloads.
 */
import { z } from "zod";
import { LEAVE_TYPES } from "./balance";

const LEAVE_TYPE_VALUES = Object.keys(LEAVE_TYPES) as Array<keyof typeof LEAVE_TYPES>;

// ── Type detection from email subject ──

const TYPE_KEYWORDS: Array<readonly [RegExp, string]> = [
  // Order matters: more specific patterns first.
  [/\bvisit[ae]\s+medic[ao]\b|\bmedical[ei]\b/i,   "MEDICAL_VISIT"],
  [/\b(?:legge\s+)?104\b/i,                         "LAW_104"],
  [/\bmatrimoni[oi]\b/i,                            "MARRIAGE"],
  [/\blutt[oi]\b/i,                                 "BEREAVEMENT"],
  [/\bmalatti[ae]\b|\binfortuni[oi]\b/i,            "SICK"],
  [/\brol\b|\bpermess[oi]\b/i,                      "ROL"],
  [/\bferi[ea]\b/i,                                 "VACATION"],
];

function stripReplyForwardPrefixes(subject: string): string {
  return subject.replace(/^(?:\s*(?:re|fwd|fw|r):\s*)+/i, "").trim();
}

export function detectLeaveTypeFromSubject(subject: string): string | null {
  const cleaned = stripReplyForwardPrefixes(subject);
  if (!cleaned) return null;
  for (const [re, type] of TYPE_KEYWORDS) {
    if (re.test(cleaned)) return type;
  }
  return null;
}

// ── parseLeaveDates with PAST_DATE rejection ──

const PAST_DATE_TOLERANCE_DAYS = 7;

export type ParseDatesResult =
  | { ok: true; startDate: string; endDate: string }
  | { ok: false; reason: "PAST_DATE" | "PARSE_ERROR" | "INVALID_RANGE"; detail?: string };

function buildDate(dd: string, mm: string, yyyy: string | undefined, fallbackYear: number): string | null {
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  let year: number;
  if (yyyy) {
    year = parseInt(yyyy, 10);
    if (year < 100) year += 2000;
  } else {
    year = fallbackYear;
  }
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((ta - tb) / (1000 * 60 * 60 * 24));
}

export function parseLeaveDates(input: string, refDate: string): ParseDatesResult {
  const cleaned = input.trim().replace(/\s+/g, " ");
  if (!cleaned) return { ok: false, reason: "PARSE_ERROR" };

  const fallbackYear = Number(refDate.slice(0, 4));

  const re1 = /dal\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+al\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i;
  const re2 = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*(?:-|al|→)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i;
  const re3 = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;

  let start: string | null = null;
  let end: string | null = null;

  const m1 = cleaned.match(re1);
  if (m1) {
    start = buildDate(m1[1], m1[2], m1[3], fallbackYear);
    end = buildDate(m1[4], m1[5], m1[6], fallbackYear);
  } else {
    const m2 = cleaned.match(re2);
    if (m2) {
      start = buildDate(m2[1], m2[2], m2[3], fallbackYear);
      end = buildDate(m2[4], m2[5], m2[6], fallbackYear);
    } else {
      const m3 = cleaned.match(re3);
      if (m3) {
        const single = buildDate(m3[1], m3[2], m3[3], fallbackYear);
        start = single;
        end = single;
      }
    }
  }

  if (!start || !end) return { ok: false, reason: "PARSE_ERROR" };

  if (start > end) {
    return { ok: false, reason: "INVALID_RANGE", detail: `${start} > ${end}` };
  }

  // PAST_DATE check: start older than refDate by more than tolerance.
  const daysOld = diffDays(refDate, start);
  if (daysOld > PAST_DATE_TOLERANCE_DAYS) {
    return { ok: false, reason: "PAST_DATE", detail: `start=${start} is ${daysOld} days before ${refDate}` };
  }

  return { ok: true, startDate: start, endDate: end };
}

// ── Zod schemas for API input ──

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato data non valido (YYYY-MM-DD)");

const timeSlotSchema = z.object({
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
});

export const createLeaveSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(LEAVE_TYPE_VALUES as [string, ...string[]]),
  startDate: dateString,
  endDate: dateString,
  hours: z.number().min(0).max(24).optional().nullable(),
  timeSlots: z.array(timeSlotSchema).max(10).optional().nullable(),
  sickProtocol: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  confirmOverride: z.boolean().optional(),
}).refine(d => d.startDate <= d.endDate, {
  message: "startDate must be <= endDate",
  path: ["endDate"],
});

export const editLeaveSchema = z.object({
  version: z.number().int().min(0),
  type: z.enum(LEAVE_TYPE_VALUES as [string, ...string[]]).optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  hours: z.number().min(0).max(24).optional().nullable(),
  timeSlots: z.array(timeSlotSchema).max(10).optional().nullable(),
  sickProtocol: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  reason: z.string().max(500).optional(),
  confirmOverride: z.boolean().optional(),
});

export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
export type EditLeaveInput = z.infer<typeof editLeaveSchema>;
