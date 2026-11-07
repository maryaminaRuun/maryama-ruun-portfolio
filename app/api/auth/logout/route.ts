import { NextResponse } from "next/server";
import { revokeSession } from "../../../../lib/auth/accounts";
import { clearCookie, isSecureRequest, readCookie, SESSION_COOKIE } from "../../../../lib/auth/web";
import { handle, json } from "../../../../lib/api";
import { getEnvDb } from "../../../../lib/db/types";
import { isSameOrigin } from "../../../../lib/security";

export async function POST(request: Request) {
  return handle(async () => {
    if (!isSameOrigin(request)) return json({ error: "Cross-site request blocked." }, 403);
    await revokeSession(await getEnvDb(), readCookie(request, SESSION_COOKIE));
    const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    clearCookie(res, SESSION_COOKIE, isSecureRequest(request));
    return res;
  });
}
