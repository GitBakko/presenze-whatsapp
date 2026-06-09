// src/lib/attendance/review-day.ts

export interface ExistingRecord {
  id: string;
  type: string;
  declaredTime: string;
}

export interface SubmittedRecord {
  id?: string;
  type: string;
  declaredTime: string;
}

export interface DayBatchPlan {
  toCreate: { type: string; declaredTime: string }[];
  toUpdate: { id: string; type: string; declaredTime: string }[];
  toDelete: string[];
  /** Final (type, declaredTime) set has a duplicate -> would violate @@unique. */
  collision: boolean;
  /** Submitted ids not found among existing records (stale client state). */
  unknownIds: string[];
}

/**
 * Pure diff of a submitted day record set against the existing records for
 * (employeeId, date). The route turns this into a $transaction.
 */
export function planDayBatch(
  existing: ExistingRecord[],
  submitted: SubmittedRecord[],
): DayBatchPlan {
  const existingById = new Map(existing.map((r) => [r.id, r]));
  const submittedIds = new Set<string>();
  const unknownIds: string[] = [];

  const toCreate: DayBatchPlan["toCreate"] = [];
  const toUpdate: DayBatchPlan["toUpdate"] = [];

  for (const s of submitted) {
    if (s.id) {
      submittedIds.add(s.id);
      const cur = existingById.get(s.id);
      if (!cur) {
        unknownIds.push(s.id);
        continue;
      }
      if (cur.type !== s.type || cur.declaredTime !== s.declaredTime) {
        toUpdate.push({ id: s.id, type: s.type, declaredTime: s.declaredTime });
      }
    } else {
      toCreate.push({ type: s.type, declaredTime: s.declaredTime });
    }
  }

  const toDelete = existing
    .filter((r) => !submittedIds.has(r.id))
    .map((r) => r.id);

  // Collision: the FINAL set (everything submitted, both kept & changed & created)
  // must have unique (type, declaredTime).
  const finalKeys = submitted.map((s) => `${s.type}|${s.declaredTime}`);
  const collision = new Set(finalKeys).size !== finalKeys.length;

  return { toCreate, toUpdate, toDelete, collision, unknownIds };
}
