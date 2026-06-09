// src/lib/presenze/issues.test.ts
import { describe, it, expect } from "vitest";
import { flattenIssues, type ReviewEmployee } from "./issues";
import type { DayClassification } from "@/lib/presenze/classify";

function day(partial: Partial<DayClassification>): DayClassification {
  return {
    date: "2026-05-04", status: "ok", scheduledHours: 8, workedHours: 8,
    leaveHours: 0, effectiveHours: 8, anomalies: [], isRed: false, isYellow: false,
    ...partial,
  };
}

const employees: ReviewEmployee[] = [
  {
    employeeId: "e1", name: "Rossi Mario", displayName: "ROSSI MARIO", overtimeTotal: 0,
    days: [
      day({ date: "2026-05-04", status: "under", isRed: true, workedHours: 6, effectiveHours: 6 }),
      day({ date: "2026-05-05", status: "ok" }), // not an issue
      day({ date: "2026-05-06", status: "absent", isRed: true, workedHours: 0, effectiveHours: 0 }),
      day({
        date: "2026-05-07", status: "over", isYellow: true, workedHours: 9, effectiveHours: 9,
        anomalies: [{ type: "TIME_OVERLAP", description: "Uscita 1 prima di Entrata 1", severity: "possible" }],
      }),
      day({
        date: "2026-05-08", status: "ok", isRed: true,
        anomalies: [{ type: "MISSING_EXIT", description: "Entrata senza uscita", severity: "structural" }],
      }),
    ],
  },
];

describe("flattenIssues", () => {
  it("emits one issue per red/yellow day, skips ok days", () => {
    const issues = flattenIssues(employees);
    expect(issues.map((i) => i.date)).toEqual([
      "2026-05-04", "2026-05-06", "2026-05-07", "2026-05-08",
    ]);
  });

  it("tags severity red for under/absent/structural and yellow for over/possible", () => {
    const issues = flattenIssues(employees);
    const byDate = Object.fromEntries(issues.map((i) => [i.date, i.severity]));
    expect(byDate["2026-05-04"]).toBe("red");
    expect(byDate["2026-05-06"]).toBe("red");
    expect(byDate["2026-05-07"]).toBe("yellow");
    expect(byDate["2026-05-08"]).toBe("red");
  });

  it("under day reason mentions ore sotto soglia", () => {
    const i = flattenIssues(employees).find((x) => x.date === "2026-05-04")!;
    expect(i.reasons.join(" ")).toMatch(/sotto soglia/i);
  });

  it("absent day reason mentions assenza", () => {
    const i = flattenIssues(employees).find((x) => x.date === "2026-05-06")!;
    expect(i.reasons.join(" ")).toMatch(/assenza/i);
  });

  it("includes anomaly descriptions in reasons", () => {
    const i = flattenIssues(employees).find((x) => x.date === "2026-05-08")!;
    expect(i.reasons.join(" ")).toMatch(/Entrata senza uscita/);
  });

  it("carries employeeId and employeeName on each issue", () => {
    const i = flattenIssues(employees)[0];
    expect(i.employeeId).toBe("e1");
    expect(i.employeeName).toBe("ROSSI MARIO");
  });
});
