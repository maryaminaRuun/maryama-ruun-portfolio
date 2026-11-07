import { NextResponse } from "next/server";
import { columnNames } from "../../../lib/db/schema";
import { ensurePortfolioTables, isInitialized } from "../../../lib/portfolio-db";
import { clientIp, rateLimit } from "../../../lib/security";

const BOT_RE = /bot|crawler|spider|crawling|preview|headless|lighthouse|monitor/i;

function deviceOf(ua: string) {
  if (/ipad|tablet/i.test(ua)) return "tablet";
  if (/mobi|android|iphone/i.test(ua)) return "mobile";
  return "desktop";
}

function referrerHost(ref: unknown, ownHost: string): string | null {
  if (typeof ref !== "string" || !ref) return null;
  try {
    const host = new URL(ref).host.replace(/^www\./, "");
    return host && host !== ownHost ? host.slice(0, 120) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const ua = request.headers.get("user-agent") || "";
  if (BOT_RE.test(ua)) return NextResponse.json({ ok: true, skipped: "bot" });

  const b = (await request.json().catch(() => ({}))) as { path?: unknown; session?: unknown; referrer?: unknown };
  const path = typeof b.path === "string" && b.path.startsWith("/") && !b.path.startsWith("/admin") ? b.path.slice(0, 120) : "/";
  const session = typeof b.session === "string" && /^[a-z0-9-]{4,80}$/i.test(b.session) ? b.session : "anonymous";

  const db = await ensurePortfolioTables().catch(() => null);
  // Nothing is recorded until the database has been set up (keeps imports clean).
  if (!db || !(await isInitialized(db))) return NextResponse.json({ ok: true, skipped: "not-initialized" });
  if (!(await rateLimit(db, `views:${clientIp(request)}`, 120, 600))) return NextResponse.json({ ok: true, skipped: "rate" });

  const now = new Date().toISOString();
  const cols = await columnNames(db, "page_views");
  if (cols.has("referrer")) {
    const ownHost = new URL(request.url).host.replace(/^www\./, "");
    await db
      .prepare("INSERT INTO page_views(path,session_id,viewed_at,referrer,country,device) VALUES(?,?,?,?,?,?)")
      .bind(path, session, now, referrerHost(b.referrer, ownHost), (request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || "").slice(0, 2) || null, deviceOf(ua))
      .run();
  } else {
    await db.prepare("INSERT INTO page_views(path,session_id,viewed_at) VALUES(?,?,?)").bind(path, session, now).run();
  }
  return NextResponse.json({ ok: true });
}
