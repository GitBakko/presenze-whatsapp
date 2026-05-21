import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/telegram-handlers", () => ({
  handleTelegramUpdate: vi.fn().mockResolvedValue(undefined),
}));

function mkReq(opts: { secret: string; header?: string; body?: unknown }): {
  request: Request;
  params: Promise<{ secret: string }>;
} {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.header !== undefined) headers["x-telegram-bot-api-secret-token"] = opts.header;
  return {
    request: new Request("http://localhost/api/telegram/webhook/anything", {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body ?? { update_id: 1 }),
    }) as unknown as import("next/server").NextRequest,
    params: Promise.resolve({ secret: opts.secret }),
  };
}

describe("POST /api/telegram/webhook/[secret]", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "correct-secret-value-32-chars-aaa";
  });

  it("503 if env missing", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const { request, params } = mkReq({ secret: "any", header: "any" });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(503);
  });

  it("403 if path secret wrong", async () => {
    const { request, params } = mkReq({ secret: "wrong", header: "correct-secret-value-32-chars-aaa" });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(403);
  });

  it("403 if header missing (strict mode)", async () => {
    const { request, params } = mkReq({ secret: "correct-secret-value-32-chars-aaa" });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(403);
  });

  it("403 if header present but wrong", async () => {
    const { request, params } = mkReq({
      secret: "correct-secret-value-32-chars-aaa",
      header: "wrong-header-value-aaaaaaaaaaaaaa",
    });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(403);
  });

  it("200 if both secret and header match", async () => {
    const { request, params } = mkReq({
      secret: "correct-secret-value-32-chars-aaa",
      header: "correct-secret-value-32-chars-aaa",
      body: { update_id: 42, message: { text: "/saldo" } },
    });
    const res = await POST(request as never, { params } as never);
    expect(res.status).toBe(200);
  });
});
