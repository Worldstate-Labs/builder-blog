/**
 * Lightweight in-memory token-bucket rate limiter, intended as a
 * best-effort guard on a single serverless instance. Because Vercel
 * spawns multiple Functions concurrently, this CANNOT replace a
 * distributed limiter (Upstash Redis / @vercel/firewall managed
 * rules) for hard quotas — but it still cuts off the easy case where
 * a single attacker hammers one warm instance.
 *
 * Usage:
 *   const r = rateLimit({ key: ipOrUserId, limit: 5, windowMs: 60_000 });
 *   if (!r.ok) return 429 with r.retryAfterMs
 *
 * The bucket and timestamps are kept in module-level memory. We trim
 * stale entries on every call so the map cannot grow unbounded.
 */

type Bucket = { tokens: number; lastRefillMs: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;
const TRIM_AFTER_MS = 10 * 60 * 1000;

function trimStale(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefillMs > TRIM_AFTER_MS) buckets.delete(key);
  }
}

export function rateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: boolean; remaining: number; retryAfterMs: number } {
  const { key, limit, windowMs } = opts;
  if (limit <= 0 || windowMs <= 0) {
    return { ok: true, remaining: limit, retryAfterMs: 0 };
  }
  const now = Date.now();
  trimStale(now);
  const refillPerMs = limit / windowMs;
  const bucket = buckets.get(key) ?? { tokens: limit, lastRefillMs: now };
  const elapsed = now - bucket.lastRefillMs;
  bucket.tokens = Math.min(limit, bucket.tokens + elapsed * refillPerMs);
  bucket.lastRefillMs = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillPerMs);
    return { ok: false, remaining: 0, retryAfterMs };
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return {
    ok: true,
    remaining: Math.floor(bucket.tokens),
    retryAfterMs: 0,
  };
}

/**
 * Best-effort client identifier for unauthenticated endpoints. Reads
 * the first `x-forwarded-for` entry (Vercel sets this), falls back to
 * `cf-connecting-ip`, then `x-real-ip`, then a stable string so the
 * limiter still rejects floods from a single origin even when the
 * proxy headers are missing.
 */
export function rateLimitKeyFromRequest(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "anonymous";
}

export function tooManyRequestsResponse(retryAfterMs: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new Response(
    JSON.stringify({ error: "Too many requests" }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(seconds),
      },
    },
  );
}
