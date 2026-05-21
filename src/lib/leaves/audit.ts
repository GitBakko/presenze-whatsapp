/**
 * Audit-trail helpers for leave edits.
 * `computeDiff` is pure; `formatDiffForNotification` produces email +
 * Telegram body snippets in Italian.
 */
import { formatItDate } from "./format";

const WATCHED_FIELDS = [
  "type",
  "startDate",
  "endDate",
  "hours",
  "timeSlots",
  "sickProtocol",
  "notes",
  "status",
] as const;

export type WatchedField = typeof WATCHED_FIELDS[number];

export interface LeaveSnapshot {
  type?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  hours?: number | null;
  timeSlots?: string | null;
  sickProtocol?: string | null;
  notes?: string | null;
  status?: string | null;
  // Allow callers to pass through full DB rows; only WATCHED_FIELDS are diffed.
  [key: string]: unknown;
}

export interface LeaveDiff {
  changedFields: WatchedField[];
  changes: Partial<Record<WatchedField, { old: unknown; new: unknown }>>;
  oldSnapshot: LeaveSnapshot;
  newSnapshot: LeaveSnapshot;
}

function eq(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  return a === b;
}

function pickWatched(s: LeaveSnapshot): LeaveSnapshot {
  const out: LeaveSnapshot = {};
  for (const f of WATCHED_FIELDS) (out as Record<string, unknown>)[f] = s[f] ?? null;
  return out;
}

export function computeDiff(prev: LeaveSnapshot, next: LeaveSnapshot): LeaveDiff {
  const changedFields: WatchedField[] = [];
  const changes: LeaveDiff["changes"] = {};
  for (const f of WATCHED_FIELDS) {
    if (!eq(prev[f], next[f])) {
      changedFields.push(f);
      changes[f] = { old: prev[f] ?? null, new: next[f] ?? null };
    }
  }
  return {
    changedFields,
    changes,
    oldSnapshot: pickWatched(prev),
    newSnapshot: pickWatched(next),
  };
}

const FIELD_LABELS_IT: Record<WatchedField, string> = {
  type: "Tipo",
  startDate: "Inizio",
  endDate: "Fine",
  hours: "Ore",
  timeSlots: "Orari",
  sickProtocol: "Protocollo INPS",
  notes: "Note",
  status: "Stato",
};

function renderValue(field: WatchedField, value: unknown): string {
  if (value == null || value === "") return "—";
  if (field === "startDate" || field === "endDate") return formatItDate(String(value));
  if (field === "hours") return `${value}h`;
  if (field === "timeSlots") {
    try {
      const slots = JSON.parse(String(value)) as Array<{ from: string; to: string }>;
      return slots.map(s => `${s.from}-${s.to}`).join(", ");
    } catch { return String(value); }
  }
  return String(value);
}

export function formatDiffForNotification(
  diff: LeaveDiff,
  _locale: "it"
): { subject: string; body: string; telegramBody: string } {
  const lines: string[] = [];
  for (const f of diff.changedFields) {
    const change = diff.changes[f];
    if (!change) continue;
    lines.push(`- ${FIELD_LABELS_IT[f]}: ${renderValue(f, change.old)} → ${renderValue(f, change.new)}`);
  }
  const subject = "La tua richiesta è stata modificata";
  const body = lines.join("\n");
  const telegramBody = `✏️ Richiesta modificata:\n${lines.join("\n")}`;
  return { subject, body, telegramBody };
}
