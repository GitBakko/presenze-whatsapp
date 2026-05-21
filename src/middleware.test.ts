import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: (handler: (req: { auth: unknown; nextUrl: URL; method: string; headers: Headers; url: string }) => unknown) => handler,
}));

// Re-import after mock so middleware uses the mocked auth wrapper
const { default: middleware } = await import("./middleware");

function mkReq(opts: {
  method: string;
  path: string;
  origin?: string;
  referer?: string;
  host?: string;
  auth?: unknown;
}) {
  const host = opts.host ?? "hr.epartner.it";
  const headers = new Headers({ host });
  if (opts.origin) headers.set("origin", opts.origin);
  if (opts.referer) headers.set("referer", opts.referer);
  const url = `https://${host}${opts.path}`;
  return {
    auth: opts.auth ?? { user: { active: true, role: "ADMIN" } },
    nextUrl: new URL(url),
    method: opts.method,
    headers,
    url,
  };
}

describe("CSRF middleware", () => {
  it("allows POST with same-origin Origin", async () => {
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
      origin: "https://hr.epartner.it",
    }) as never);
    expect((res as Response).status).not.toBe(403);
  });

  it("blocks POST with cross-origin Origin", async () => {
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
      origin: "https://evil.com",
    }) as never);
    expect((res as Response).status).toBe(403);
  });

  it("falls back to Referer when Origin missing (same host = ok)", async () => {
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
      referer: "https://hr.epartner.it/leaves",
    }) as never);
    expect((res as Response).status).not.toBe(403);
  });

  it("blocks POST when both Origin and Referer missing", async () => {
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
    }) as never);
    expect((res as Response).status).toBe(403);
  });

  it("allows GET regardless of Origin", async () => {
    const res = await middleware(mkReq({
      method: "GET",
      path: "/api/leaves",
    }) as never);
    expect((res as Response).status).not.toBe(403);
  });
});
