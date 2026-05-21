type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitOpts {
  key: string;
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(opts: RateLimitOpts): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(opts.key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(opts.key, bucket);
  }
  bucket.count++;
  const ok = bucket.count <= opts.max;
  const remaining = Math.max(0, opts.max - bucket.count);
  return { ok, remaining, resetAt: bucket.resetAt };
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/** @internal test helper */
export function _resetBucketsForTest(): void {
  buckets.clear();
}
