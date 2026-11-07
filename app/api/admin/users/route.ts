import { adminGuard, audit } from "../../../../lib/admin";
import { addEditor, removeEditor } from "../../../../lib/admin-content";
import { handle, json } from "../../../../lib/api";

export async function POST(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const { email } = (await request.json().catch(() => ({}))) as { email?: unknown };
    await addEditor(g.db, email, g.admin.email);
    await audit(g.db, g.admin.email, "add-editor", "user", String(email));
    return json({ ok: true });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const email = new URL(request.url).searchParams.get("email");
    await removeEditor(g.db, email);
    await audit(g.db, g.admin.email, "remove-editor", "user", email);
    return json({ ok: true });
  });
}
