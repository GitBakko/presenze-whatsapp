import { describe, it, expect, beforeEach, vi } from "vitest";
import { rateLimit, getClientIp, _resetBucketsForTest } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    _resetBucketsForTest();
  });

  it("allows first hit", () => {
    const r = rateLimit({ key: "test:1", max: 3, windowMs: 60_000 });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("blocks after max hits in window", () => {
    rateLimit({ key: "test:2", max: 2, windowMs: 60_000 });
    rateLimit({ key: "test:2", max: 2, windowMs: 60_000 });
    const r = rateLimit({ key: "test:2", max: 2, windowMs: 60_000 });
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("resets after window expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T10:00:00Z"));
    rateLimit({ key: "test:3", max: 1, windowMs: 1000 });
    const blocked = rateLimit({ key: "test:3", max: 1, windowMs: 1000 });
    expect(blocked.ok).toBe(false);
    vi.setSystemTime(new Date("2026-05-21T10:00:02Z"));
    const reset = rateLimit({ key: "test:3", max: 1, windowMs: 1000 });
    expect(reset.ok).toBe(true);
    vi.useRealTimers();
  });

  it("isolates keys", () => {
    rateLimit({ key: "key-a", max: 1, windowMs: 60_000 });
    const blockedA = rateLimit({ key: "key-a", max: 1, windowMs: 60_000 });
    const okB = rateLimit({ key: "key-b", max: 1, windowMs: 60_000 });
    expect(blockedA.ok).toBe(false);
    expect(okB.ok).toBe(true);
  });

  it.each([0, -1, NaN, Infinity])("throws RangeError when max is %s", (max) => {
    expect(() => rateLimit({ key: "bad", max, windowMs: 1000 })).toThrow(RangeError);
  });

  it.each([0, -1, NaN, Infinity])("throws RangeError when windowMs is %s", (windowMs) => {
    expect(() => rateLimit({ key: "bad", max: 1, windowMs })).toThrow(RangeError);
  });
});

describe("getClientIp", () => {
  function mkReq(headers: Record<string, string>): Request {
    return new Request("http://localhost/test", { headers });
  }

  it("returns first hop of X-Forwarded-For", () => {
    const req = mkReq({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const req = mkReq({ "x-real-ip": "5.6.7.8" });
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no header", () => {
    const req = mkReq({});
    expect(getClientIp(req)).toBe("unknown");
  });
});
