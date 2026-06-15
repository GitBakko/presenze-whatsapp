import { describe, it, expect } from "vitest";
import { buildLeaveDayMap } from "./excel-presenze";

describe("buildLeaveDayMap — presenze report leave expansion", () => {
  const from = "2026-05-01";
  const to = "2026-05-31";

  it("VACATION Fri→Sun maps ONLY the working Friday, never Sat/Sun", () => {
    // 2026-05-15 Fri, 16 Sat, 17 Sun (Giovanni's reported case)
    const map = buildLeaveDayMap(
      [{ employeeId: "e1", type: "VACATION", hours: null, startDate: "2026-05-15", endDate: "2026-05-17" }],
      from,
      to,
    );
    expect(map.get("e1|2026-05-15")).toEqual({ type: "VACATION", hours: null });
    expect(map.has("e1|2026-05-16")).toBe(false); // Sat — was wrongly charged 8h before
    expect(map.has("e1|2026-05-17")).toBe(false); // Sun — was wrongly charged 8h before
  });

  it("skips national holidays inside the range (no ferie charged on a festività)", () => {
    // 2026-05-01 Festa del Lavoro → never mapped even though in range.
    const map = buildLeaveDayMap(
      [{ employeeId: "e1", type: "VACATION", hours: null, startDate: "2026-05-01", endDate: "2026-05-01" }],
      from,
      to,
    );
    expect(map.has("e1|2026-05-01")).toBe(false);
  });

  it("clips the leave to the [from,to] window and skips weekend/holiday inside it", () => {
    const map = buildLeaveDayMap(
      [{ employeeId: "e1", type: "VACATION", hours: null, startDate: "2026-04-29", endDate: "2026-05-05" }],
      from,
      to,
    );
    expect(map.has("e1|2026-04-30")).toBe(false); // before window
    expect(map.has("e1|2026-05-01")).toBe(false); // holiday
    expect(map.has("e1|2026-05-02")).toBe(false); // Sat
    expect(map.has("e1|2026-05-03")).toBe(false); // Sun
    expect(map.get("e1|2026-05-04")).toEqual({ type: "VACATION", hours: null }); // Mon
    expect(map.get("e1|2026-05-05")).toEqual({ type: "VACATION", hours: null }); // Tue
  });

  it("keeps the first leave when two overlap the same working day", () => {
    const map = buildLeaveDayMap(
      [
        { employeeId: "e1", type: "VACATION", hours: null, startDate: "2026-05-04", endDate: "2026-05-04" },
        { employeeId: "e1", type: "SICK", hours: null, startDate: "2026-05-04", endDate: "2026-05-04" },
      ],
      from,
      to,
    );
    expect(map.get("e1|2026-05-04")?.type).toBe("VACATION");
  });

  it("preserves hourly leave hours (ROL) on a working day", () => {
    const map = buildLeaveDayMap(
      [{ employeeId: "e1", type: "ROL", hours: 4, startDate: "2026-05-04", endDate: "2026-05-04" }],
      from,
      to,
    );
    expect(map.get("e1|2026-05-04")).toEqual({ type: "ROL", hours: 4 });
  });
});
