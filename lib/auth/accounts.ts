// Admin accounts, MFA verification, sessions and editor invites (database logic only).
import type { D1Like } from "../db/types";
import { b64url, hashPassword, newRecoveryCodes, openSecret, randomBytes, sha256Hex, verifyPassword, verifyTotp } from "./crypto";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // absolute lifetime
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000; // sign out after 2 h without activity
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const MAX_FAILED = 8;
export const LOCK_MS = 15 * 60 * 1000;

export type Account = {
  email: string; password_hash: string; totp_secret: string; totp_last_step: number; recovery_codes: string;
  failed_attempts: number; locked_until: number; created_at: string; updated_at: string; last_login_at: string | null;
};

const norm = (email: string) => email.trim().toLowerCase();

export async function getAccount(db: D1Like, email: string): Promise<Account | null> {
  return db.prepare("SELECT * FROM admin_accounts WHERE email = ?").bind(norm(email)).first<Account>();
}

export async function hasAccount(db: D1Like, email: string) {
  return !!(await getAccount(db, email));
}

/** Create or replace an account (password + enrolled MFA). Revokes existing sessions. Returns new recovery codes (shown once). */
export async function saveAccount(db: D1Like, email: string, passwordHash: string, sealedTotpSecret: string, enrolledStep: number): Promise<string[]> {
  const e = norm(email);
  const codes = newRecoveryCodes();
  const hashes = await Promise.all(codes.map((c) => sha256Hex(c)));
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO admin_accounts (email, password_hash, totp_secret, totp_last_step, recovery_codes, failed_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, totp_secret=excluded.totp_secret, totp_last_step=excluded.totp_last_step, recovery_codes=excluded.recovery_codes, failed_attempts=0, locked_until=0, updated_at=excluded.updated_at",
      )
      .bind(e, passwordHash, sealedTotpSecret, enrolledStep, JSON.stringify(hashes), now, now),
    db.prepare("DELETE FROM admin_sessions WHERE email = ?").bind(e),
  ]);
  return codes;
}

export type PasswordCheck = { ok: true } | { ok: false; reason: "invalid" | "locked"; retryAfterSec?: number };

export async function checkPassword(db: D1Like, email: string, password: string, now = Date.now()): Promise<PasswordCheck> {
  const acct = await getAccount(db, email);
  if (!acct) {
    // Spend comparable time so response timing doesn't reveal which emails exist.
    await verifyPassword(password, "pbkdf2_sha256$310000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    return { ok: false, reason: "invalid" };
  }
  if (acct.locked_until > now) return { ok: false, reason: "locked", retryAfterSec: Math.ceil((acct.locked_until - now) / 1000) };
  if (await verifyPassword(password, acct.password_hash)) return { ok: true };
  await recordFailure(db, acct, now);
  return { ok: false, reason: "invalid" };
}

async function recordFailure(db: D1Like, acct: Account, now: number) {
  const failed = acct.failed_attempts + 1;
  const lock = failed >= MAX_FAILED ? now + LOCK_MS : 0;
  await db.prepare("UPDATE admin_accounts SET failed_attempts = ?, locked_until = ? WHERE email = ?").bind(lock ? 0 : failed, lock, acct.email).run();
}

/** Second factor: a 6-digit authenticator code (not reusable) or a one-time recovery code. */
export async function checkSecondFactor(db: D1Like, email: string, code: string, now = Date.now()): Promise<{ ok: boolean; usedRecovery?: boolean; locked?: boolean }> {
  const acct = await getAccount(db, email);
  if (!acct) return { ok: false };
  if (acct.locked_until > now) return { ok: false, locked: true };
  const clean = code.trim().toLowerCase();
  if (/^\d{6}$/.test(clean.replace(/\s/g, ""))) {
    const step = await verifyTotp(await openSecret(acct.totp_secret), clean, acct.totp_last_step, now);
    if (step !== null) {
      await db.prepare("UPDATE admin_accounts SET totp_last_step = ?, failed_attempts = 0, last_login_at = ? WHERE email = ?").bind(step, new Date(now).toISOString(), acct.email).run();
      return { ok: true };
    }
  } else if (/^[a-z2-7]{5}-[a-z2-7]{5}$/.test(clean)) {
    const hashes = JSON.parse(acct.recovery_codes) as string[];
    const h = await sha256Hex(clean);
    if (hashes.includes(h)) {
      await db
        .prepare("UPDATE admin_accounts SET recovery_codes = ?, failed_attempts = 0, last_login_at = ? WHERE email = ?")
        .bind(JSON.stringify(hashes.filter((x) => x !== h)), new Date(now).toISOString(), acct.email)
        .run();
      return { ok: true, usedRecovery: true };
    }
  }
  await recordFailure(db, acct, now);
  return { ok: false };
}

export async function remainingRecoveryCodes(db: D1Like, email: string): Promise<number> {
  const a = await getAccount(db, email);
  return a ? (JSON.parse(a.recovery_codes) as string[]).length : 0;
}

export async function regenerateRecoveryCodes(db: D1Like, email: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await db.prepare("UPDATE admin_accounts SET recovery_codes = ?, updated_at = ? WHERE email = ?").bind(JSON.stringify(await Promise.all(codes.map(sha256Hex))), new Date().toISOString(), norm(email)).run();
  return codes;
}

export async function changePassword(db: D1Like, email: string, newPassword: string, keepSessionHash: string | null) {
  const e = norm(email);
  await db.batch([
    db.prepare("UPDATE admin_accounts SET password_hash = ?, updated_at = ? WHERE email = ?").bind(await hashPassword(newPassword), new Date().toISOString(), e),
    db.prepare("DELETE FROM admin_sessions WHERE email = ? AND id_hash != ?").bind(e, keepSessionHash ?? ""),
  ]);
}

export async function deleteAccount(db: D1Like, email: string) {
  const e = norm(email);
  await db.batch([
    db.prepare("DELETE FROM admin_sessions WHERE email = ?").bind(e),
    db.prepare("DELETE FROM admin_accounts WHERE email = ?").bind(e),
    db.prepare("DELETE FROM admin_invites WHERE email = ?").bind(e),
  ]);
}

// ---- Sessions ----
export async function createSession(db: D1Like, email: string, ip: string | null, userAgent: string | null, now = Date.now()): Promise<string> {
  const token = b64url(randomBytes(32));
  await db
    .prepare("INSERT INTO admin_sessions (id_hash, email, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), norm(email), now, now + SESSION_TTL_MS, now, ip?.slice(0, 64) ?? null, userAgent?.slice(0, 200) ?? null)
    .run();
  // Housekeeping: drop expired sessions.
  await db.prepare("DELETE FROM admin_sessions WHERE expires_at < ? OR last_seen_at < ?").bind(now, now - SESSION_IDLE_MS).run();
  return token;
}

export async function validateSession(db: D1Like, token: string | undefined | null, now = Date.now()): Promise<{ email: string; idHash: string } | null> {
  if (!token || token.length > 100) return null;
  const idHash = await sha256Hex(token);
  const s = await db.prepare("SELECT email, expires_at, last_seen_at FROM admin_sessions WHERE id_hash = ?").bind(idHash).first<{ email: string; expires_at: number; last_seen_at: number }>();
  if (!s) return null;
  if (s.expires_at < now || s.last_seen_at < now - SESSION_IDLE_MS) {
    await db.prepare("DELETE FROM admin_sessions WHERE id_hash = ?").bind(idHash).run();
    return null;
  }
  if (now - s.last_seen_at > 5 * 60 * 1000) await db.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id_hash = ?").bind(now, idHash).run();
  return { email: s.email, idHash };
}

export async function revokeSession(db: D1Like, token: string | undefined | null) {
  if (token) await db.prepare("DELETE FROM admin_sessions WHERE id_hash = ?").bind(await sha256Hex(token)).run();
}

export async function revokeOtherSessions(db: D1Like, email: string, keepIdHash: string) {
  await db.prepare("DELETE FROM admin_sessions WHERE email = ? AND id_hash != ?").bind(norm(email), keepIdHash).run();
}

export async function listSessions(db: D1Like, email: string) {
  return (
    await db.prepare("SELECT id_hash, created_at, last_seen_at, expires_at, ip, user_agent FROM admin_sessions WHERE email = ? ORDER BY last_seen_at DESC").bind(norm(email)).all<{
      id_hash: string; created_at: number; last_seen_at: number; expires_at: number; ip: string | null; user_agent: string | null;
    }>()
  ).results;
}

// ---- Editor invites ----
export async function createInvite(db: D1Like, email: string, actor: string, now = Date.now()): Promise<string> {
  const token = b64url(randomBytes(32));
  const e = norm(email);
  await db.batch([
    db.prepare("DELETE FROM admin_invites WHERE email = ? AND used_at IS NULL").bind(e),
    db.prepare("INSERT INTO admin_invites (token_hash, email, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?)").bind(await sha256Hex(token), e, new Date(now).toISOString(), now + INVITE_TTL_MS, actor),
  ]);
  return token;
}

export async function findInvite(db: D1Like, token: string | undefined | null, now = Date.now()): Promise<{ email: string; tokenHash: string } | null> {
  if (!token || token.length > 100) return null;
  const h = await sha256Hex(token);
  const row = await db.prepare("SELECT email, expires_at, used_at FROM admin_invites WHERE token_hash = ?").bind(h).first<{ email: string; expires_at: number; used_at: string | null }>();
  if (!row || row.used_at || row.expires_at < now) return null;
  return { email: row.email, tokenHash: h };
}

export async function markInviteUsed(db: D1Like, tokenHash: string) {
  await db.prepare("UPDATE admin_invites SET used_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), tokenHash).run();
}
