import { NextResponse } from "next/server";
import { createSession, markInviteUsed, saveAccount, SESSION_TTL_MS } from "../../../../../lib/auth/accounts";
import { openSecret, verifyToken, verifyTotp } from "../../../../../lib/auth/crypto";
import { FlowError, limit } from "../../../../../lib/auth/flows";
import { clearCookie, ENROLL_COOKIE, isSecureRequest, readCookie, SESSION_COOKIE, setCookie } from "../../../../../lib/auth/web";
import { audit } from "../../../../../lib/admin";
import { handle, json } from "../../../../../lib/api";
import { ensureAppSchema } from "../../../../../lib/db/schema";
import { getEnvDb } from "../../../../../lib/db/types";
import { clientIp, isSameOrigin } from "../../../../../lib/security";

type Pending = { email: string; passwordHash: string; secret: string; inviteHash: string | null; purpose: string };

/** Confirm the first authenticator code. Saves the account, returns one-time recovery codes and signs in. */
export async function POST(request: Request) {
  return handle(async () => {
    if (!isSameOrigin(request)) return json({ error: "Cross-site request blocked." }, 403);
    const db = await getEnvDb();
    await ensureAppSchema(db);
    const p = await verifyToken<Pending>(readCookie(request, ENROLL_COOKIE));
    if (!p || p.purpose !== "enroll") return json({ error: "Setup took too long. Start again.", restart: true }, 401);
    try {
      await limit(db, request, "enroll-confirm", 15, 900);
    } catch (e) {
      if (e instanceof FlowError) return json({ error: e.message }, e.status);
      throw e;
    }
    const { code } = (await request.json().catch(() => ({}))) as { code?: unknown };
    const step = await verifyTotp(await openSecret(p.secret), typeof code === "string" ? code : "", 0);
    if (step === null) return json({ error: "That code doesn't match. Check the time on your phone and enter the current 6-digit code." }, 400);
    const recoveryCodes = await saveAccount(db, p.email, p.passwordHash, p.secret, step);
    if (p.inviteHash) await markInviteUsed(db, p.inviteHash);
    await audit(db, p.email, p.inviteHash ? "editor enrolled" : "owner setup", "account", p.email);
    const token = await createSession(db, p.email, clientIp(request), request.headers.get("user-agent"));
    const secure = isSecureRequest(request);
    const res = NextResponse.json({ ok: true, recoveryCodes }, { headers: { "cache-control": "no-store" } });
    setCookie(res, SESSION_COOKIE, token, Math.floor(SESSION_TTL_MS / 1000), secure);
    clearCookie(res, ENROLL_COOKIE, secure);
    return res;
  });
}
