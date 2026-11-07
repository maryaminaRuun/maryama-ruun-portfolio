import { adminGuard, audit } from "../../../../lib/admin";
import { updateSettings } from "../../../../lib/admin-content";
import { handle, json } from "../../../../lib/api";

export async function POST(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await updateSettings(g.db, body);
    await audit(g.db, g.admin.email, "update", "settings", null, { keys: Object.keys(body) });
    return json({ ok: true });
  });
}
