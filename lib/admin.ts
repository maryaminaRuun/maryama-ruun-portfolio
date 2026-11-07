import { NextResponse } from "next/server";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { ensureLegacyTables, tableExists } from "./db/schema";
import type { D1Like } from "./db/types";
import { getEnvDb } from "./db/types";
import { isSameOrigin } from "./security";

import { OWNER_EMAIL_LOWER } from "./owner";
import { resolveRole, type Role } from "./roles";

export { resolveRole, type Role };
export const OWNER_EMAIL = OWNER_EMAIL_LOWER;
export type AdminSession = { email: string; name: string; role: Role };

const RANK: Record<Role, number> = { editor: 1, owner: 2 };

/**
 * Identity comes from the hosting platform's signed-in user (ChatGPT sign-in,
 * which supports MFA on the account). Authorization (owner/editor) is ours.
 */
export async function getAdminSession(db: D1Like | null): Promise<AdminSession | null> {
  const user = await getChatGPTUser();
  if (!user) return null;
  const role = await resolveRole(db, user.email);
  return role ? { email: user.email.toLowerCase(), name: user.displayName, role } : null;
}

type GuardOk = { ok: true; db: D1Like; admin: AdminSession };
type GuardFail = { ok: false; response: NextResponse };

export async function adminGuard(request: Request, minRole: Role, opts: { mutating?: boolean } = {}): Promise<GuardOk | GuardFail> {
  if (opts.mutating && !isSameOrigin(request)) {
    return { ok: false, response: NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 }) };
  }
  const db = await getEnvDb();
  await ensureLegacyTables(db);
  const admin = await getAdminSession(db);
  if (!admin) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  if (RANK[admin.role] < RANK[minRole]) {
    return { ok: false, response: NextResponse.json({ error: "Only the portfolio owner can do this." }, { status: 403 }) };
  }
  return { ok: true, db, admin };
}

export async function audit(db: D1Like, actor: string, action: string, entity: string, entityId: string | number | null, detail?: unknown) {
  if (!(await tableExists(db, "audit_log").catch(() => false))) return;
  await db
    .prepare("INSERT INTO audit_log (actor, action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(actor, action, entity, entityId === null ? null : String(entityId), detail === undefined ? null : JSON.stringify(detail).slice(0, 2000), new Date().toISOString())
    .run();
}

export const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
