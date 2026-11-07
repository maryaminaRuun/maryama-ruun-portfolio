import { NextResponse } from "next/server";
import { ensurePortfolioTables } from "../../../lib/portfolio-db";
import { clientIp, cleanText, EMAIL_RE, rateLimit } from "../../../lib/security";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  // Honeypot: real visitors never see this field. Pretend success so bots don't retry.
  if (cleanText(body.website, 200)) return NextResponse.json({ ok: true });

  const name = cleanText(body.name, 120);
  const email = cleanText(body.email, 200);
  const subject = cleanText(body.subject, 200);
  const message = cleanText(body.message, 5000);
  if (!name || !email || !subject || !message) return NextResponse.json({ error: "Please complete every field." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });

  const db = await ensurePortfolioTables();
  if (!(await rateLimit(db, `contact:${clientIp(request)}`, 5, 3600))) {
    return NextResponse.json({ error: "Too many messages from this connection. Please try again later or email me directly." }, { status: 429 });
  }
  await db
    .prepare("INSERT INTO contact_messages (name,email,subject,message,status,created_at) VALUES (?,?,?,?,?,?)")
    .bind(name, email, subject, message, "unread", new Date().toISOString())
    .run();
  return NextResponse.json({ ok: true });
}
