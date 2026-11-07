import { adminGuard, audit } from "../../../../lib/admin";
import { AdminError } from "../../../../lib/admin-content";
import { handle, json } from "../../../../lib/api";
import { changePassword, checkPassword, checkSecondFactor, listSessions, regenerateRecoveryCodes, remainingRecoveryCodes, revokeOtherSessions } from "../../../../lib/auth/accounts";
import { passwordProblem } from "../../../../lib/auth/crypto";

/** The signed-in person's own security settings. */
export async function GET(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "editor");
    if (!g.ok) return g.response;
    const sessions = (await listSessions(g.db, g.admin.email)).map((s) => ({
      current: s.id_hash === g.admin.sessionIdHash, createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at, ip: s.ip, userAgent: s.user_agent,
    }));
    return json({ email: g.admin.email, recoveryCodesLeft: await remainingRecoveryCodes(g.db, g.admin.email), sessions });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "editor", { mutating: true });
    if (!g.ok) return g.response;
    const b = (await request.json().catch(() => ({}))) as { action?: unknown; currentPassword?: unknown; newPassword?: unknown; code?: unknown };
    const code = typeof b.code === "string" ? b.code : "";
    if (b.action === "signout-others") {
      await revokeOtherSessions(g.db, g.admin.email, g.admin.sessionIdHash);
      await audit(g.db, g.admin.email, "signout-others", "session", null);
      return json({ ok: true });
    }
    // Sensitive changes need a fresh authenticator code.
    if (!(await checkSecondFactor(g.db, g.admin.email, code)).ok) throw new AdminError("Enter the current code from your authenticator app.", 401);
    if (b.action === "recovery-codes") {
      const codes = await regenerateRecoveryCodes(g.db, g.admin.email);
      await audit(g.db, g.admin.email, "regenerate-recovery-codes", "account", g.admin.email);
      return json({ ok: true, recoveryCodes: codes });
    }
    if (b.action === "password") {
      const current = typeof b.currentPassword === "string" ? b.currentPassword : "";
      const next = typeof b.newPassword === "string" ? b.newPassword : "";
      if (!(await checkPassword(g.db, g.admin.email, current)).ok) throw new AdminError("Your current password is not correct.", 401);
      const problem = passwordProblem(next, g.admin.email);
      if (problem) throw new AdminError(problem);
      await changePassword(g.db, g.admin.email, next, g.admin.sessionIdHash);
      await audit(g.db, g.admin.email, "change-password", "account", g.admin.email);
      return json({ ok: true });
    }
    throw new AdminError("Unknown action.");
  });
}
