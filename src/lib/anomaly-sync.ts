import { prisma } from "./db";
import type { DailyStats } from "./calculator";
import { getLeaveForDate } from "./leaves";
import { todayRome } from "./tz";

/**
 * Check if an employee's date is fully covered by leave (skip all anomalies)
 */
async function isFullDayLeave(employeeId: string, date: string): Promise<boolean> {
  const leave = await getLeaveForDate(employeeId, date);
  if (!leave) return false;
  // Full-day types
  if (["VACATION", "VACATION_HALF_AM", "VACATION_HALF_PM", "SICK"].includes(leave.type)) {
    return leave.type !== "VACATION_HALF_AM" && leave.type !== "VACATION_HALF_PM";
  }
  return false;
}

/**
 * Pure: suppress new anomalies (and stale-cleanup) for days strictly after
 * the employee's inclusive termination date. termDate at UTC midnight.
 */
export function shouldSuppressAnomaly(termDate: Date | null, date: string): boolean {
  if (!termDate) return false;
  return date > todayRome(termDate);
}

/**
 * Persist detected anomalies from calculated daily stats.
 * - Skips anomaly creation for dates fully covered by approved leave
 * - Creates new anomalies that don't exist yet
 * - Removes (or marks resolved) unresolved anomalies that no longer apply
 * - Preserves resolved anomalies (manual resolutions are never touched)
 *
 * @param options.resolveNote - When set, stale unresolved anomalies are marked
 *   as resolved with this note instead of being deleted. Useful when a record
 *   edit automatically resolves existing anomalies.
 */
export async function syncAnomalies(
  dailyStats: DailyStats[],
  options?: { resolveNote?: string }
): Promise<number> {
  let created = 0;

  // Batch-load termination dates once for all employees we're processing.
  const empIds = [...new Set(dailyStats.map((s) => s.employeeId))];
  const terminatedRows = await prisma.employee.findMany({
    where: { id: { in: empIds }, terminationDate: { not: null } },
    select: { id: true, terminationDate: true },
  });
  const terminationByEmp = new Map<string, Date | null>(
    terminatedRows.map((e) => [e.id, e.terminationDate]),
  );

  // Collect all employee+date combos we're processing
  const processedKeys = new Set<string>();

  for (const ds of dailyStats) {
    // Skip post-termination days entirely: do NOT create anomalies and do
    // NOT add to processedKeys (so the stale-cleanup pass leaves them alone).
    if (shouldSuppressAnomaly(terminationByEmp.get(ds.employeeId) ?? null, ds.date)) {
      continue;
    }

    processedKeys.add(`${ds.employeeId}|${ds.date}`);

    // Skip anomaly creation if date is fully covered by approved leave
    const fullLeave = await isFullDayLeave(ds.employeeId, ds.date);
    if (fullLeave) continue;

    for (const anomaly of ds.anomalies) {
      // Upsert: create only if not already existing for this employee+date+type
      const existing = await prisma.anomaly.findFirst({
        where: {
          employeeId: ds.employeeId,
          date: ds.date,
          type: anomaly.type,
        },
      });

      if (!existing) {
        await prisma.anomaly.create({
          data: {
            employeeId: ds.employeeId,
            date: ds.date,
            type: anomaly.type,
            description: anomaly.description,
          },
        });
        created++;
      }
    }
  }

  // Remove unresolved anomalies for processed days where the anomaly type no longer appears
  for (const key of processedKeys) {
    const [employeeId, date] = key.split("|");
    const ds = dailyStats.find(
      (s) => s.employeeId === employeeId && s.date === date
    );
    const currentTypes = ds ? ds.anomalies.map((a) => a.type) : [];

    // Find unresolved anomalies for this employee+date that are no longer detected
    const staleAnomalies = await prisma.anomaly.findMany({
      where: {
        employeeId,
        date,
        resolved: false,
        ...(currentTypes.length > 0
          ? { type: { notIn: currentTypes } }
          : {}),
      },
    });

    if (staleAnomalies.length > 0) {
      if (options?.resolveNote) {
        await prisma.anomaly.updateMany({
          where: { id: { in: staleAnomalies.map((a) => a.id) } },
          data: {
            resolved: true,
            resolvedAt: new Date(),
            resolution: options.resolveNote,
          },
        });
      } else {
        await prisma.anomaly.deleteMany({
          where: {
            id: { in: staleAnomalies.map((a) => a.id) },
          },
        });
      }
    }
  }

  return created;
}
