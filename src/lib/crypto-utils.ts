import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string compare. Returns false immediately on length mismatch
 * (length itself is not secret).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
