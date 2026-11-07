import { tableExists } from "./db/schema";
import type { D1Like } from "./db/types";
import { OWNER_EMAIL_LOWER } from "./owner";

export type Role = "owner" | "editor";

/** Owner is fixed in code; editors are invited by the owner (admin_users table). */
export async function resolveRole(db: D1Like | null, email: string): Promise<Role | null> {
  const e = email.trim().toLowerCase();
  if (e === OWNER_EMAIL_LOWER) return "owner";
  if (!db || !(await tableExists(db, "admin_users").catch(() => false))) return null;
  const row = await db.prepare("SELECT role FROM admin_users WHERE email = ?").bind(e).first<{ role: string }>();
  return row?.role === "editor" ? "editor" : null;
}
