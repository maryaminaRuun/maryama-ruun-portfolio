import { NextResponse } from "next/server";
import { ensurePortfolioTables } from "../../../lib/portfolio-db";

export async function POST(request: Request) {
  const body = await request.json() as Record<string, string>;
  const name = body.name?.trim(); const email = body.email?.trim();
  const subject = body.subject?.trim(); const message = body.message?.trim();
  if (!name || !email || !subject || !message || !email.includes("@")) return NextResponse.json({ error: "Please complete every field." }, { status: 400 });
  const db = await ensurePortfolioTables();
  await db.prepare("INSERT INTO contact_messages (name,email,subject,message,status,created_at) VALUES (?,?,?,?,?,?)").bind(name,email,subject,message,"unread",new Date().toISOString()).run();
  return NextResponse.json({ ok: true });
}
