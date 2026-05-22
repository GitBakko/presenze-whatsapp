import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { logger, _setLogLevelForTest } from "./logger";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    _setLogLevelForTest("debug");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits JSON one-line with ts, level, msg, meta", () => {
    logger.info({ worker: "test", count: 3 }, "hello");
    expect(logSpy).toHaveBeenCalledOnce();
    const raw = logSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(raw);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.worker).toBe("test");
    expect(parsed.count).toBe(3);
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("routes warn → console.warn and error → console.error", () => {
    logger.warn({ worker: "t" }, "w");
    logger.error({ worker: "t" }, "e");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("suppresses debug below threshold", () => {
    _setLogLevelForTest("info");
    logger.debug({ worker: "t" }, "ignored");
    logger.info({ worker: "t" }, "kept");
    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it("handles circular meta without throwing", () => {
    const a: Record<string, unknown> = { worker: "t" };
    a.self = a;
    expect(() => logger.info(a, "x")).not.toThrow();
    expect(logSpy).toHaveBeenCalledOnce();
    const raw = logSpy.mock.calls[0]![0] as string;
    expect(raw).toContain('"msg":"x"');
  });
});
