import { NextResponse } from "next/server";
import { sessionFromCookies, sessionFromRequest } from "./auth/web";
import { ensureAppSchema, tableExists } from "./db/schema";
import type { D1Like } from "./db/types";
import { getEnvDb } from "./db/types";
import { isSameOrigin } from "./security";
import { OWNER_EMAIL_LOWER } from "./owner";
import { resolveRole, type Role } from "./roles";

export { resolveRole, type Role };
export const OWNER_EMAIL = OWNER_EMAIL_LOWER;
export type AdminSession = { email: string; name: string; role: Role; sessionIdHash: string };

const RANK: Record<Role, number> = { editor: 1, owner: 2 };

function displayName(email: string, role: Role) {
  return role === "owner" ? "Maryama Ruun" : email;
}

/**
 * Identity: the built-in sign-in (password + mandatory authenticator code),
 * checked through a server-side session. Authorization: owner (fixed) or editor
 * (invited). A removed editor loses access on their next request.
 */
export async function getAdminSession(db: D1Like, request?: Request): Promise<AdminSession | null> {
  const s = request ? await sessionFromRequest(db, request) : await sessionFromCookies(db);
  if (!s) return null;
  const role = await resolveRole(db, s.email);
  return role ? { email: s.email, name: displayName(s.email, role), role, sessionIdHash: s.idHash } : null;
}

type GuardOk = { ok: true; db: D1Like; admin: AdminSession };
type GuardFail = { ok: false; response: NextResponse };

export async function adminGuard(request: Request, minRole: Role, opts: { mutating?: boolean } = {}): Promise<GuardOk | GuardFail> {
  if (opts.mutating && !isSameOrigin(request)) {
    return { ok: false, response: NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 }) };
  }
  const db = await getEnvDb();
  await ensureAppSchema(db);
  const admin = await getAdminSession(db, request);
  if (!admin) return { ok: false, response: NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 }) };
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
