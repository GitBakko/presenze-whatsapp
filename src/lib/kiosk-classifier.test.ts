import { describe, it, expect } from "vitest";
import {
  computeState,
  computeZone,
  classifyPunch,
  decideAction,
  resolveSchedule,
} from "./kiosk-classifier";

const DEFAULT_SCHEDULE = {
  block1Start: "09:00",
  block1End: "13:00",
  block2Start: "14:30",
  block2End: "18:30",
};

describe("resolveSchedule", () => {
  it("uses provided schedule when all fields are set", () => {
    const sched = { block1Start: "08:00", block1End: "12:00", block2Start: "13:00", block2End: "17:00" };
    expect(resolveSchedule(sched)).toEqual(sched);
  });

  it("falls back to defaults when schedule is null", () => {
    const result = resolveSchedule(null);
    expect(result.block1Start).toBe("09:00");
    expect(result.block2End).toBe("18:30");
  });

  it("falls back to defaults when a field is null", () => {
    const partial = { block1Start: "08:00", block1End: null, block2Start: "13:00", block2End: "17:00" };
    const result = resolveSchedule(partial);
    expect(result.block1Start).toBe("09:00"); // fell back to default
  });
});

describe("computeState", () => {
  it("returns FUORI when no last record", () => {
    expect(computeState(null)).toBe("FUORI");
    expect(computeState(undefined)).toBe("FUORI");
  });

  it("returns AL_LAVORO after ENTRY", () => {
    expect(computeState({ type: "ENTRY" })).toBe("AL_LAVORO");
  });

  it("returns AL_LAVORO after PAUSE_END", () => {
    expect(computeState({ type: "PAUSE_END" })).toBe("AL_LAVORO");
  });

  it("returns IN_PAUSA after PAUSE_START", () => {
    expect(computeState({ type: "PAUSE_START" })).toBe("IN_PAUSA");
  });

  it("returns FUORI after EXIT", () => {
    expect(computeState({ type: "EXIT" })).toBe("FUORI");
  });

  it("returns AL_LAVORO after OVERTIME_START", () => {
    expect(computeState({ type: "OVERTIME_START" })).toBe("AL_LAVORO");
  });

  it("returns FUORI after OVERTIME_END", () => {
    expect(computeState({ type: "OVERTIME_END" })).toBe("FUORI");
  });
});

describe("computeZone", () => {
  it("returns PRIMA_LAVORO before block1", () => {
    expect(computeZone("08:00", DEFAULT_SCHEDULE)).toBe("PRIMA_LAVORO");
  });

  it("returns DENTRO_BLOCCO_1 during morning block", () => {
    expect(computeZone("10:00", DEFAULT_SCHEDULE)).toBe("DENTRO_BLOCCO_1");
  });

  it("returns USCITA_BLOCCO_1 near end of block1 (within 30min tolerance)", () => {
    expect(computeZone("12:30", DEFAULT_SCHEDULE)).toBe("USCITA_BLOCCO_1");
    expect(computeZone("12:45", DEFAULT_SCHEDULE)).toBe("USCITA_BLOCCO_1");
    expect(computeZone("13:00", DEFAULT_SCHEDULE)).toBe("USCITA_BLOCCO_1");
  });

  it("returns DENTRO_BLOCCO_1 before exit tolerance", () => {
    expect(computeZone("12:29", DEFAULT_SCHEDULE)).toBe("DENTRO_BLOCCO_1");
  });

  it("returns PAUSA_PRANZO between blocks", () => {
    expect(computeZone("13:30", DEFAULT_SCHEDULE)).toBe("PAUSA_PRANZO");
    expect(computeZone("14:00", DEFAULT_SCHEDULE)).toBe("PAUSA_PRANZO");
  });

  it("returns DENTRO_BLOCCO_2 during afternoon block", () => {
    expect(computeZone("15:00", DEFAULT_SCHEDULE)).toBe("DENTRO_BLOCCO_2");
  });

  it("returns USCITA_BLOCCO_2 near end of block2", () => {
    expect(computeZone("18:00", DEFAULT_SCHEDULE)).toBe("USCITA_BLOCCO_2");
    expect(computeZone("18:30", DEFAULT_SCHEDULE)).toBe("USCITA_BLOCCO_2");
  });

  it("returns DOPO_LAVORO after block2", () => {
    expect(computeZone("19:00", DEFAULT_SCHEDULE)).toBe("DOPO_LAVORO");
  });
});

describe("classifyPunch", () => {
  it("FUORI → always ENTRY", () => {
    expect(classifyPunch("FUORI", "PRIMA_LAVORO")).toBe("ENTRY");
    expect(classifyPunch("FUORI", "DENTRO_BLOCCO_1")).toBe("ENTRY");
    expect(classifyPunch("FUORI", "DOPO_LAVORO")).toBe("ENTRY");
  });

  it("IN_PAUSA → always PAUSE_END", () => {
    expect(classifyPunch("IN_PAUSA", "DENTRO_BLOCCO_1")).toBe("PAUSE_END");
    expect(classifyPunch("IN_PAUSA", "PAUSA_PRANZO")).toBe("PAUSE_END");
  });

  it("AL_LAVORO + DENTRO_BLOCCO → PAUSE_START", () => {
    expect(classifyPunch("AL_LAVORO", "DENTRO_BLOCCO_1")).toBe("PAUSE_START");
    expect(classifyPunch("AL_LAVORO", "DENTRO_BLOCCO_2")).toBe("PAUSE_START");
  });

  it("AL_LAVORO + USCITA_BLOCCO → EXIT (going to lunch / end of day)", () => {
    expect(classifyPunch("AL_LAVORO", "USCITA_BLOCCO_1")).toBe("EXIT");
    expect(classifyPunch("AL_LAVORO", "USCITA_BLOCCO_2")).toBe("EXIT");
  });

  it("AL_LAVORO + PAUSA_PRANZO/PRIMA/DOPO → EXIT", () => {
    expect(classifyPunch("AL_LAVORO", "PAUSA_PRANZO")).toBe("EXIT");
    expect(classifyPunch("AL_LAVORO", "PRIMA_LAVORO")).toBe("EXIT");
    expect(classifyPunch("AL_LAVORO", "DOPO_LAVORO")).toBe("EXIT");
  });
});

describe("decideAction (integration)", () => {
  it("first tap of the day → ENTRY", () => {
    expect(decideAction({ last: null, now: "09:00", schedule: DEFAULT_SCHEDULE })).toBe("ENTRY");
  });

  it("tap at 12:30 after ENTRY → EXIT (near end of block1)", () => {
    expect(decideAction({ last: { type: "ENTRY" }, now: "12:30", schedule: DEFAULT_SCHEDULE })).toBe("EXIT");
  });

  it("tap at 10:30 after ENTRY → PAUSE_START (mid-block)", () => {
    expect(decideAction({ last: { type: "ENTRY" }, now: "10:30", schedule: DEFAULT_SCHEDULE })).toBe("PAUSE_START");
  });

  it("tap after PAUSE_START → PAUSE_END", () => {
    expect(decideAction({ last: { type: "PAUSE_START" }, now: "10:45", schedule: DEFAULT_SCHEDULE })).toBe("PAUSE_END");
  });

  it("tap at 18:30 after PAUSE_END → EXIT (end of day)", () => {
    expect(decideAction({ last: { type: "PAUSE_END" }, now: "18:30", schedule: DEFAULT_SCHEDULE })).toBe("EXIT");
  });

  it("tap after EXIT → ENTRY (re-entering)", () => {
    expect(decideAction({ last: { type: "EXIT" }, now: "14:30", schedule: DEFAULT_SCHEDULE })).toBe("ENTRY");
  });
});
