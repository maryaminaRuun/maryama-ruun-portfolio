import { NextResponse } from "next/server";
import { checkPassword } from "../../../../lib/auth/accounts";
import { signToken } from "../../../../lib/auth/crypto";
import { FlowError, limit } from "../../../../lib/auth/flows";
import { isSecureRequest, MFA_COOKIE, setCookie } from "../../../../lib/auth/web";
import { handle, json } from "../../../../lib/api";
import { ensureAppSchema } from "../../../../lib/db/schema";
import { getEnvDb } from "../../../../lib/db/types";
import { resolveRole } from "../../../../lib/roles";
import { cleanText, isSameOrigin } from "../../../../lib/security";

/** Step 1 of 2: password. Success only unlocks the authenticator-code step (5 minutes). */
export async function POST(request: Request) {
  return handle(async () => {
    if (!isSameOrigin(request)) return json({ error: "Cross-site request blocked." }, 403);
    const db = await getEnvDb();
    await ensureAppSchema(db);
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
    const email = cleanText(body.email, 200).toLowerCase();
    const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
    try {
      await limit(db, request, "login", 20, 900);
      await limit(db, request, `login:${email}`, 10, 900);
    } catch (e) {
      if (e instanceof FlowError) return json({ error: e.message }, e.status);
      throw e;
    }
    const result = (await resolveRole(db, email)) ? await checkPassword(db, email, password) : await checkPassword(db, "", password);
    if (!result.ok) {
      if (result.reason === "locked") return json({ error: `Too many failed attempts. Try again in ${Math.ceil((result.retryAfterSec ?? 900) / 60)} minutes.` }, 429);
      return json({ error: "Email or password is incorrect." }, 401);
    }
    const res = NextResponse.json({ ok: true, next: "mfa" }, { headers: { "cache-control": "no-store" } });
    setCookie(res, MFA_COOKIE, await signToken({ email, purpose: "mfa" }, 300), 300, isSecureRequest(request));
    return res;
  });
}
