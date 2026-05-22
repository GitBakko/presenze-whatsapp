import { describe, it, expect, beforeEach } from "vitest";
import {
  setStartedAt,
  recordRunning,
  recordTick,
  recordWsListening,
  recordWsConnection,
  snapshot,
  _resetForTest,
} from "./worker-metrics";

describe("worker-metrics", () => {
  beforeEach(() => _resetForTest());

  it("auto-inits a slot on first use", () => {
    recordRunning("alpha", true);
    const s = snapshot().alpha!;
    expect(s.running).toBe(true);
    expect(s.totalCycles).toBe(0);
    expect(s.lastTickAt).toBeNull();
  });

  it("setStartedAt + recordRunning toggle correctly", () => {
    setStartedAt("alpha");
    recordRunning("alpha", true);
    expect(snapshot().alpha!.running).toBe(true);
    expect(snapshot().alpha!.startedAt).not.toBeNull();
    recordRunning("alpha", false);
    expect(snapshot().alpha!.running).toBe(false);
  });

  it("recordTick ok updates lastSuccessAt and durations ring buffer", () => {
    for (let i = 0; i < 12; i++) {
      recordTick("alpha", { ok: true, durationMs: i });
    }
    const s = snapshot().alpha!;
    expect(s.totalCycles).toBe(12);
    expect(s.totalErrors).toBe(0);
    expect(s.lastSuccessAt).not.toBeNull();
    expect(s.lastErrorAt).toBeNull();
    expect(s.recentDurationsMs).toHaveLength(10);
    expect(s.recentDurationsMs[0]).toBe(2);
    expect(s.recentDurationsMs[9]).toBe(11);
  });

  it("recordTick error updates lastErrorAt + lastErrorMessage", () => {
    recordTick("alpha", { ok: false, errorMessage: "boom" });
    const s = snapshot().alpha!;
    expect(s.totalCycles).toBe(1);
    expect(s.totalErrors).toBe(1);
    expect(s.lastErrorAt).not.toBeNull();
    expect(s.lastErrorMessage).toBe("boom");
    expect(s.lastSuccessAt).toBeNull();
  });

  it("recordWsListening and recordWsConnection track ws fields", () => {
    recordWsListening(true);
    recordWsConnection(1);
    recordWsConnection(1);
    recordWsConnection(1);
    recordWsConnection(-1);
    const s = snapshot()["ws-notifications"]!;
    expect(s.listening).toBe(true);
    expect(s.clients).toBe(2);
    expect(s.totalConnections).toBe(3);
  });

  it("clients clamps at 0 even with extra -1", () => {
    recordWsConnection(-1);
    recordWsConnection(-1);
    expect(snapshot()["ws-notifications"]!.clients).toBe(0);
  });

  it("record* functions are no-throw on bad input", () => {
    expect(() => recordTick("", { ok: true })).not.toThrow();
    expect(() => recordRunning("", true)).not.toThrow();
  });
});
