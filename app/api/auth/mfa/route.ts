import { NextResponse } from "next/server";
import { checkSecondFactor, createSession, remainingRecoveryCodes, SESSION_TTL_MS } from "../../../../lib/auth/accounts";
import { verifyToken } from "../../../../lib/auth/crypto";
import { FlowError, limit } from "../../../../lib/auth/flows";
import { clearCookie, isSecureRequest, MFA_COOKIE, readCookie, SESSION_COOKIE, setCookie } from "../../../../lib/auth/web";
import { audit } from "../../../../lib/admin";
import { handle, json } from "../../../../lib/api";
import { ensureAppSchema } from "../../../../lib/db/schema";
import { getEnvDb } from "../../../../lib/db/types";
import { resolveRole } from "../../../../lib/roles";
import { clientIp, isSameOrigin } from "../../../../lib/security";

/** Step 2 of 2: authenticator code (or a one-time recovery code). Creates the session. */
export async function POST(request: Request) {
  return handle(async () => {
    if (!isSameOrigin(request)) return json({ error: "Cross-site request blocked." }, 403);
    const db = await getEnvDb();
    await ensureAppSchema(db);
    const pending = await verifyToken<{ email: string; purpose: string }>(readCookie(request, MFA_COOKIE));
    if (!pending || pending.purpose !== "mfa") return json({ error: "Your sign-in step expired. Enter your password again.", restart: true }, 401);
    try {
      await limit(db, request, "mfa", 20, 900);
    } catch (e) {
      if (e instanceof FlowError) return json({ error: e.message }, e.status);
      throw e;
    }
    const { code } = (await request.json().catch(() => ({}))) as { code?: unknown };
    const r = await checkSecondFactor(db, pending.email, typeof code === "string" ? code.slice(0, 20) : "");
    if (!r.ok) return json({ error: r.locked ? "Too many failed attempts. Try again in 15 minutes." : "That code is not valid. Use the current code from your authenticator app." }, r.locked ? 429 : 401);
    if (!(await resolveRole(db, pending.email))) return json({ error: "This account no longer has access." }, 403);
    const token = await createSession(db, pending.email, clientIp(request), request.headers.get("user-agent"));
    await audit(db, pending.email, r.usedRecovery ? "sign-in (recovery code)" : "sign-in", "session", null);
    const secure = isSecureRequest(request);
    const res = NextResponse.json({ ok: true, usedRecovery: !!r.usedRecovery, recoveryCodesLeft: r.usedRecovery ? await remainingRecoveryCodes(db, pending.email) : undefined }, { headers: { "cache-control": "no-store" } });
    setCookie(res, SESSION_COOKIE, token, Math.floor(SESSION_TTL_MS / 1000), secure);
    clearCookie(res, MFA_COOKIE, secure);
    return res;
  });
}
