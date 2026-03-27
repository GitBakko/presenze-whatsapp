import { prisma } from "./db";
import type { DailyStats } from "./calculator";
import { getLeaveForDate, LEAVE_TYPES, type LeaveType } from "./leaves";

/**
 * Check if an employee's date is fully covered by leave (skip all anomalies)
 */
async function isFullDayLeave(employeeId: string, date: string): Promise<boolean> {
  const leave = await getLeaveForDate(employeeId, date);
  if (!leave) return false;
  const config = LEAVE_TYPES[leave.type];
  // Full-day types
  if (["VACATION", "VACATION_HALF_AM", "VACATION_HALF_PM", "SICK"].includes(leave.type)) {
    return leave.type !== "VACATION_HALF_AM" && leave.type !== "VACATION_HALF_PM";
  }
  return false;
}

/**
 * Persist detected anomalies from calculated daily stats.
 * - Skips anomaly creation for dates fully covered by approved leave
 * - Creates new anomalies that don't exist yet
 * - Removes unresolved anomalies that no longer apply (e.g. records were fixed)
 * - Preserves resolved anomalies (manual resolutions are never deleted)
 */
export async function syncAnomalies(dailyStats: DailyStats[]): Promise<number> {
  let created = 0;

  // Collect all employee+date combos we're processing
  const processedKeys = new Set<string>();

  for (const ds of dailyStats) {
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
      await prisma.anomaly.deleteMany({
        where: {
          id: { in: staleAnomalies.map((a) => a.id) },
        },
      });
    }
  }

  return created;
}
