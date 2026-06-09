import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: (handler: (req: { auth: unknown; nextUrl: URL; method: string; headers: Headers; url: string }) => unknown) => handler,
}));

// Re-import after mock so middleware uses the mocked auth wrapper.
// The real export is typed as a 2-arg NextAuth middleware (req, event); under
// the mocked `auth` (handler => handler) it is a 1-arg handler at runtime. Cast
// to the runtime shape so the single-arg test calls typecheck under tsc --noEmit
// (CI) exactly as they already pass at runtime under vitest.
const { default: middlewareImpl } = await import("./middleware");
const middleware = middlewareImpl as unknown as (req: unknown) => Promise<Response>;

function mkReq(opts: {
  method: string;
  path: string;
  origin?: string;
  referer?: string;
  host?: string;
  forwardedHost?: string;
  auth?: unknown;
}) {
  const host = opts.host ?? "hr.epartner.it";
  const headers = new Headers({ host });
  if (opts.forwardedHost) headers.set("x-forwarded-host", opts.forwardedHost);
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

  it("uses X-Forwarded-Host when behind reverse-proxy (Host is internal)", async () => {
    // Simulate IIS ARR: Host = upstream internal, XFH = real public, Origin = real public
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
      host: "127.0.0.1:3100",
      forwardedHost: "hr.epartner.it",
      origin: "https://hr.epartner.it",
    }) as never);
    expect((res as Response).status).not.toBe(403);
  });

  it("blocks cross-origin even with matching X-Forwarded-Host check", async () => {
    const res = await middleware(mkReq({
      method: "POST",
      path: "/api/leaves",
      host: "127.0.0.1:3100",
      forwardedHost: "hr.epartner.it",
      origin: "https://evil.com",
    }) as never);
    expect((res as Response).status).toBe(403);
  });
});
