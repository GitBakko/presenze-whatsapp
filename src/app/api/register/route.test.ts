import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";
import { _resetBucketsForTest } from "@/lib/rate-limit";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

function mkReq(body: unknown, ip = "10.0.0.1"): Request {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/register", () => {
  beforeEach(() => {
    _resetBucketsForTest();
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.create).mockReset();
    process.env.SYSTEM_REGISTRATION_SECRET = "admin-secret-value-32-chars-aaaa";
  });

  it("400 on missing fields", async () => {
    const res = await POST(mkReq({}) as never);
    expect(res.status).toBe(400);
  });

  it("400 on invalid email", async () => {
    const res = await POST(mkReq({ email: "not-an-email", name: "Mario", password: "12345678" }) as never);
    expect(res.status).toBe(400);
  });

  it("400 on short password", async () => {
    const res = await POST(mkReq({ email: "a@epartner.it", name: "Mario", password: "short" }) as never);
    expect(res.status).toBe(400);
  });

  it("400 on name with HTML/script chars", async () => {
    const res = await POST(mkReq({
      email: "a@epartner.it",
      name: "<script>alert(1)</script>",
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(400);
  });

  it("400 on name too long", async () => {
    const res = await POST(mkReq({
      email: "a@epartner.it",
      name: "x".repeat(101),
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(400);
  });

  it("403 on disallowed domain (employee path)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await POST(mkReq({
      email: "mario@evil.com",
      name: "Mario Rossi",
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(403);
  });

  it("403 on wrong systemPassword (admin path)", async () => {
    const res = await POST(mkReq({
      email: "admin@evil.com",
      name: "Admin",
      password: "validpass123",
      systemPassword: "wrong-value-totally-different-aa",
    }) as never);
    expect(res.status).toBe(403);
  });

  it("202 mask on existing email (employee path)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "x" } as never);
    const res = await POST(mkReq({
      email: "exists@epartner.it",
      name: "Mario Rossi",
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(202);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("202 mask on new email (employee path)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "new", email: "new@epartner.it", name: "Mario Rossi", role: "EMPLOYEE", active: false,
    } as never);
    const res = await POST(mkReq({
      email: "new@epartner.it",
      name: "Mario Rossi",
      password: "validpass123",
    }) as never);
    expect(res.status).toBe(202);
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it("201 detailed on admin reg (correct systemPassword)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "adm", email: "admin@anywhere.com", name: "Admin", role: "ADMIN", active: true,
    } as never);
    const res = await POST(mkReq({
      email: "admin@anywhere.com",
      name: "Admin",
      password: "validpass123",
      systemPassword: "admin-secret-value-32-chars-aaaa",
    }) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("ADMIN");
  });

  it("409 on existing email (admin path, no mask)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "x" } as never);
    const res = await POST(mkReq({
      email: "admin@anywhere.com",
      name: "Admin",
      password: "validpass123",
      systemPassword: "admin-secret-value-32-chars-aaaa",
    }) as never);
    expect(res.status).toBe(409);
  });

  it("429 after 5 hits in window (same IP)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "x", email: "x@epartner.it", name: "x", role: "EMPLOYEE", active: false,
    } as never);
    for (let i = 0; i < 5; i++) {
      await POST(mkReq({ email: `u${i}@epartner.it`, name: "User", password: "validpass123" }, "1.1.1.1") as never);
    }
    const res = await POST(mkReq({ email: "u6@epartner.it", name: "User", password: "validpass123" }, "1.1.1.1") as never);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});
