import { describe, it, expect } from "vitest";
import {
  detectLeaveTypeFromSubject,
  parseLeaveDates,
  createLeaveSchema,
  editLeaveSchema,
} from "../validation";

describe("detectLeaveTypeFromSubject", () => {
  it("detects VACATION from 'ferie'", () => {
    expect(detectLeaveTypeFromSubject("ferie")).toBe("VACATION");
    expect(detectLeaveTypeFromSubject("Re: Fwd: Richiesta ferie estate")).toBe("VACATION");
  });

  it("detects ROL from 'rol' or 'permesso'", () => {
    expect(detectLeaveTypeFromSubject("ROL del 22/05")).toBe("ROL");
    expect(detectLeaveTypeFromSubject("permesso visita")).toBe("ROL");
  });

  it("detects SICK from 'malattia'", () => {
    expect(detectLeaveTypeFromSubject("malattia 3 giorni")).toBe("SICK");
  });

  it("detects BEREAVEMENT, MARRIAGE, LAW_104, MEDICAL_VISIT", () => {
    expect(detectLeaveTypeFromSubject("Lutto familiare")).toBe("BEREAVEMENT");
    expect(detectLeaveTypeFromSubject("matrimonio 15/06")).toBe("MARRIAGE");
    expect(detectLeaveTypeFromSubject("legge 104")).toBe("LAW_104");
    expect(detectLeaveTypeFromSubject("visita medica")).toBe("MEDICAL_VISIT");
  });

  it("returns null when no keyword matches", () => {
    expect(detectLeaveTypeFromSubject("ciao come va")).toBeNull();
    expect(detectLeaveTypeFromSubject("")).toBeNull();
  });

  it("strips Re:/Fwd: prefixes case-insensitively", () => {
    expect(detectLeaveTypeFromSubject("RE: re: FWD: ferie")).toBe("VACATION");
  });
});

describe("parseLeaveDates", () => {
  it("parses 'DAL gg/mm AL gg/mm' with current year", () => {
    const r = parseLeaveDates("DAL 22/05 AL 25/05", "2026-05-20");
    expect(r).toEqual({ ok: true, startDate: "2026-05-22", endDate: "2026-05-25" });
  });

  it("rejects when start is in the past more than 7 days", () => {
    const r = parseLeaveDates("DAL 15/04 AL 18/04", "2026-12-20");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("PAST_DATE");
  });

  it("accepts dates within 7-day back-date tolerance", () => {
    const r = parseLeaveDates("DAL 22/05 AL 22/05", "2026-05-25");
    expect(r.ok).toBe(true);
  });

  it("rejects inverted range as INVALID_RANGE", () => {
    const r = parseLeaveDates("DAL 25/05 AL 22/05", "2026-05-20");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INVALID_RANGE");
  });

  it("returns PARSE_ERROR for unrecognized input", () => {
    const r = parseLeaveDates("ciao mondo", "2026-05-20");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("PARSE_ERROR");
  });

  it("respects explicit year when provided", () => {
    const r = parseLeaveDates("DAL 22/05/2027 AL 25/05/2027", "2026-05-20");
    expect(r).toEqual({ ok: true, startDate: "2027-05-22", endDate: "2027-05-25" });
  });
});

describe("createLeaveSchema (Zod)", () => {
  it("accepts valid VACATION input", () => {
    const r = createLeaveSchema.safeParse({
      employeeId: "emp_1",
      type: "VACATION",
      startDate: "2026-05-22",
      endDate: "2026-05-25",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid type", () => {
    const r = createLeaveSchema.safeParse({
      employeeId: "emp_1",
      type: "BOGUS",
      startDate: "2026-05-22",
      endDate: "2026-05-25",
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative hours", () => {
    const r = createLeaveSchema.safeParse({
      employeeId: "emp_1",
      type: "ROL",
      startDate: "2026-05-22",
      endDate: "2026-05-22",
      hours: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects notes longer than 2000 chars", () => {
    const r = createLeaveSchema.safeParse({
      employeeId: "emp_1",
      type: "VACATION",
      startDate: "2026-05-22",
      endDate: "2026-05-25",
      notes: "x".repeat(2001),
    });
    expect(r.success).toBe(false);
  });
});

describe("editLeaveSchema (Zod)", () => {
  it("requires version for edit operations", () => {
    const r = editLeaveSchema.safeParse({
      startDate: "2026-05-22",
      endDate: "2026-05-25",
    });
    expect(r.success).toBe(false);
  });

  it("accepts partial fields with version", () => {
    const r = editLeaveSchema.safeParse({
      version: 0,
      startDate: "2026-05-22",
    });
    expect(r.success).toBe(true);
  });
});
