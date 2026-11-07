import { adminGuard, audit } from "../../../../lib/admin";
import { addEditor, AdminError, removeEditor } from "../../../../lib/admin-content";
import { handle, json } from "../../../../lib/api";
import { createInvite, deleteAccount } from "../../../../lib/auth/accounts";
import { cleanText } from "../../../../lib/security";

/** Add an editor and create a single-use invite link (valid 72 hours). Re-sending creates a new link. */
export async function POST(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const { email } = (await request.json().catch(() => ({}))) as { email?: unknown };
    const e = cleanText(email, 200).toLowerCase();
    await addEditor(g.db, e, g.admin.email);
    const row = await g.db.prepare("SELECT email FROM admin_users WHERE email = ?").bind(e).first();
    if (!row) throw new AdminError("Could not add this editor.");
    const token = await createInvite(g.db, e, g.admin.email);
    await audit(g.db, g.admin.email, "invite-editor", "user", e);
    const inviteUrl = `${new URL(request.url).origin}/admin/invite?token=${encodeURIComponent(token)}`;
    return json({ ok: true, inviteUrl });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const email = new URL(request.url).searchParams.get("email") || "";
    await removeEditor(g.db, email);
    await deleteAccount(g.db, email);
    await audit(g.db, g.admin.email, "remove-editor", "user", email);
    return json({ ok: true });
  });
}
