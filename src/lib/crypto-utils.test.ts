import { describe, it, expect } from "vitest";
import { constantTimeEquals } from "./crypto-utils";

describe("constantTimeEquals", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEquals("hello", "hello")).toBe(true);
  });

  it("returns false for different strings same length", () => {
    expect(constantTimeEquals("hello", "world")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(constantTimeEquals("hello", "hell")).toBe(false);
    expect(constantTimeEquals("a", "ab")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(constantTimeEquals("", "")).toBe(true);
  });

  it("handles multi-byte unicode correctly", () => {
    expect(constantTimeEquals("café", "café")).toBe(true);
    expect(constantTimeEquals("café", "cafè")).toBe(false);
  });
});
