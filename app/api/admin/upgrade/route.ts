import { adminGuard } from "../../../../lib/admin";
import { AdminError } from "../../../../lib/admin-content";
import { handle, json } from "../../../../lib/api";
import { applyUpgradeV1 } from "../../../../lib/db/upgrade";

export async function POST(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const body = (await request.json().catch(() => ({}))) as { backupSha256?: unknown; confirm?: unknown };
    if (body.confirm !== "UPGRADE") throw new AdminError('Type UPGRADE to confirm.');
    const report = await applyUpgradeV1(g.db, g.admin.email, String(body.backupSha256 || ""));
    return json({ ok: true, report });
  });
}
