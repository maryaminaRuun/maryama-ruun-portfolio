import { tableExists } from "./db/schema";
import type { D1Like } from "./db/types";

const memoryBuckets = new Map<string, { count: number; start: number }>();

/**
 * Fixed-window rate limiter. Uses the `rate_limits` table once the database is
 * upgraded (shared across all Worker instances); before that it falls back to
 * a per-instance in-memory window.
 */
export async function rateLimit(db: D1Like | null, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  if (db && (await tableExists(db, "rate_limits").catch(() => false))) {
    const row = await db.prepare("SELECT count, window_start FROM rate_limits WHERE bucket = ?").bind(bucket).first<{ count: number; window_start: number }>();
    if (!row || row.window_start !== windowStart) {
      await db.prepare("INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = excluded.window_start").bind(bucket, windowStart).run();
      return true;
    }
    if (row.count >= limit) return false;
    await db.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?").bind(bucket).run();
    return true;
  }
  const m = memoryBuckets.get(bucket);
  if (!m || m.start !== windowStart) {
    memoryBuckets.set(bucket, { count: 1, start: windowStart });
    if (memoryBuckets.size > 5000) memoryBuckets.clear();
    return true;
  }
  if (m.count >= limit) return false;
  m.count += 1;
  return true;
}

export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("cf-connecting-ip") || "unknown";
}

/** Rejects cross-site state-changing requests (CSRF defence for cookie/header-based auth). */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return site === "same-origin";
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

/** Only allow http(s) links, site-relative paths and mailto: in stored URLs. */
export function cleanUrl(value: unknown): string {
  const v = cleanText(value, 500);
  if (!v) return "";
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  if (/^mailto:[^\s]+$/i.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}
