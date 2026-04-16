import { describe, it, expect } from "vitest";
import { formatLeaveDetail } from "./leave-format";

describe("formatLeaveDetail — context today", () => {
  const today = "2026-04-16";

  it("single-day vacation on today → 'solo oggi'", () => {
    expect(formatLeaveDetail({ type: "VACATION", startDate: "2026-04-16", endDate: "2026-04-16", hours: null, timeSlots: null }, "today", today)).toBe("solo oggi");
  });
  it("multi-day vacation ending in the future → 'fino al DD Mese'", () => {
    expect(formatLeaveDetail({ type: "VACATION", startDate: "2026-04-14", endDate: "2026-04-25", hours: null, timeSlots: null }, "today", today)).toBe("fino al 25 Aprile");
  });
  it("half-day AM → 'mattina'", () => {
    expect(formatLeaveDetail({ type: "VACATION_HALF_AM", startDate: "2026-04-16", endDate: "2026-04-16", hours: null, timeSlots: null }, "today", today)).toBe("mattina");
  });
  it("half-day PM → 'pomeriggio'", () => {
    expect(formatLeaveDetail({ type: "VACATION_HALF_PM", startDate: "2026-04-16", endDate: "2026-04-16", hours: null, timeSlots: null }, "today", today)).toBe("pomeriggio");
  });
  it("ROL with timeSlots → 'dalle HH:MM alle HH:MM'", () => {
    expect(formatLeaveDetail({ type: "ROL", startDate: "2026-04-16", endDate: "2026-04-16", hours: 3, timeSlots: '[{"from":"09:00","to":"12:00"}]' }, "today", today)).toBe("dalle 9:00 alle 12:00");
  });
  it("strips leading zero from hours in timeSlots", () => {
    expect(formatLeaveDetail({ type: "ROL", startDate: "2026-04-16", endDate: "2026-04-16", hours: 1.5, timeSlots: '[{"from":"08:30","to":"10:00"}]' }, "today", today)).toBe("dalle 8:30 alle 10:00");
  });
  it("sick multi-day → 'fino al DD Mese'", () => {
    expect(formatLeaveDetail({ type: "SICK", startDate: "2026-04-10", endDate: "2026-04-20", hours: null, timeSlots: null }, "today", today)).toBe("fino al 20 Aprile");
  });
});

describe("formatLeaveDetail — context upcoming", () => {
  const today = "2026-04-16";

  it("single future day → 'il DD Mese'", () => {
    expect(formatLeaveDetail({ type: "VACATION", startDate: "2026-04-22", endDate: "2026-04-22", hours: null, timeSlots: null }, "upcoming", today)).toBe("il 22 Aprile");
  });
  it("multi-day range → 'dal DD Mese al DD Mese'", () => {
    expect(formatLeaveDetail({ type: "VACATION", startDate: "2026-04-21", endDate: "2026-04-25", hours: null, timeSlots: null }, "upcoming", today)).toBe("dal 21 Aprile al 25 Aprile");
  });
  it("cross-month range → 'dal DD Mese al DD Mese'", () => {
    expect(formatLeaveDetail({ type: "SICK", startDate: "2026-03-23", endDate: "2026-04-03", hours: null, timeSlots: null }, "upcoming", today)).toBe("dal 23 Marzo al 3 Aprile");
  });
  it("half-day AM future → 'il DD Mese, mattina'", () => {
    expect(formatLeaveDetail({ type: "VACATION_HALF_AM", startDate: "2026-04-22", endDate: "2026-04-22", hours: null, timeSlots: null }, "upcoming", today)).toBe("il 22 Aprile, mattina");
  });
  it("ROL with timeSlots future → 'il DD Mese, dalle HH:MM alle HH:MM'", () => {
    expect(formatLeaveDetail({ type: "ROL", startDate: "2026-04-22", endDate: "2026-04-22", hours: 2, timeSlots: '[{"from":"09:00","to":"11:00"}]' }, "upcoming", today)).toBe("il 22 Aprile, dalle 9:00 alle 11:00");
  });
});
