// src/lib/presenze/issues.ts
import type { DayClassification, DayStatus } from "@/lib/presenze/classify";

export interface ReviewEmployee {
  employeeId: string;
  name: string;
  displayName: string;
  days: DayClassification[];
  overtimeTotal: number;
}

export interface Issue {
  employeeId: string;
  employeeName: string;
  date: string;
  status: DayStatus;
  severity: "red" | "yellow";
  reasons: string[]; // human descriptions
  recordIds: string[]; // editable records on that day (empty for absence)
}

/**
 * Flatten the per-employee classifications into a sortable worklist of
 * red/yellow days. Pure. `recordIds` is left empty here (the route does not
 * carry them in the classification); the day editor fetches records on open.
 */
export function flattenIssues(employees: ReviewEmployee[]): Issue[] {
  const issues: Issue[] = [];
  for (const emp of employees) {
    for (const d of emp.days) {
      if (!d.isRed && !d.isYellow && !d.exceedsDailyCap) continue;
      const reasons: string[] = [];
      if (d.status === "absent") reasons.push("Assenza non giustificata");
      else if (d.status === "under") reasons.push(`Ore sotto soglia (${d.effectiveHours}h / ${d.scheduledHours}h)`);
      else if (d.status === "over") reasons.push(`Ore sopra soglia (${d.effectiveHours}h / ${d.scheduledHours}h)`);
      if (d.exceedsDailyCap) reasons.push(`Lavorate + assenze ${d.rawEffectiveHours}h superano il massimo giornaliero (${d.dailyCapHours}h)`);
      for (const a of d.anomalies) reasons.push(a.description);
      issues.push({
        employeeId: emp.employeeId,
        employeeName: emp.displayName,
        date: d.date,
        status: d.status,
        severity: d.isRed ? "red" : "yellow",
        reasons,
        recordIds: [],
      });
    }
  }
  return issues;
}
