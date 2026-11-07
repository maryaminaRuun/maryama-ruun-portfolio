import { NextResponse } from "next/server";
import { signToken } from "../../../../../lib/auth/crypto";
import { FlowError, limit, startEnrollment } from "../../../../../lib/auth/flows";
import { ENROLL_COOKIE, isSecureRequest, setCookie } from "../../../../../lib/auth/web";
import { handle, json } from "../../../../../lib/api";
import { ensureAppSchema } from "../../../../../lib/db/schema";
import { getEnvDb } from "../../../../../lib/db/types";
import { isSameOrigin } from "../../../../../lib/security";

/** Owner setup (with ADMIN_SETUP_KEY) or editor invite: choose a password, get the authenticator QR code. */
export async function POST(request: Request) {
  return handle(async () => {
    if (!isSameOrigin(request)) return json({ error: "Cross-site request blocked." }, 403);
    const db = await getEnvDb();
    await ensureAppSchema(db);
    try {
      await limit(db, request, "enroll", 10, 900);
      const r = await startEnrollment(db, (await request.json().catch(() => ({}))) as Record<string, unknown>);
      const res = NextResponse.json({ ok: true, ...r.display }, { headers: { "cache-control": "no-store" } });
      setCookie(res, ENROLL_COOKIE, await signToken({ ...r.pending, purpose: "enroll" }, 600), 600, isSecureRequest(request));
      return res;
    } catch (e) {
      if (e instanceof FlowError) return json({ error: e.message }, e.status);
      throw e;
    }
  });
}
