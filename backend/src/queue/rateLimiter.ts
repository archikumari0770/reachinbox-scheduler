import { redisConnection } from "./connection";
import { env } from "../config/env";

const HOUR_MS = 60 * 60 * 1000;

function hourBucketKey(senderId: string, at: Date): string {
  const bucket = new Date(at);
  bucket.setMinutes(0, 0, 0);
  return `ratelimit:${senderId}:${bucket.toISOString()}`;
}

export function startOfNextHour(at: Date): Date {
  const next = new Date(at);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  nextWindowStart: Date;
}

/**
 * Atomically increments the per-sender, per-hour counter and reports whether
 * this send is allowed. Uses Redis INCR + EXPIRE (both atomic), so it is
 * correct even with many worker processes hammering it concurrently — no
 * in-memory counter is involved, satisfying the "safe across multiple
 * workers/instances" requirement.
 */
export async function tryConsumeRateLimit(
  senderId: string,
  limitOverride?: number
): Promise<RateLimitResult> {
  const limit = limitOverride ?? env.worker.maxEmailsPerHourPerSender;
  const now = new Date();
  const key = hourBucketKey(senderId, now);

  const count = await redisConnection.incr(key);
  if (count === 1) {
    // first hit in this window — set the bucket to expire after 1 hour
    await redisConnection.expire(key, Math.ceil(HOUR_MS / 1000));
  }

  if (count > limit) {
    // Over the cap: give the slot back (we didn't actually send) and reject.
    await redisConnection.decr(key);
    return { allowed: false, count: count - 1, limit, nextWindowStart: startOfNextHour(now) };
  }

  return { allowed: true, count, limit, nextWindowStart: startOfNextHour(now) };
}

/** Current count in the sender's active hour window, for dashboards/debugging. */
export async function getCurrentHourCount(senderId: string): Promise<number> {
  const key = hourBucketKey(senderId, new Date());
  const val = await redisConnection.get(key);
  return val ? parseInt(val, 10) : 0;
}
