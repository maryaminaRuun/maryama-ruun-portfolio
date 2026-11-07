import hosting from "../../../../.openai/hosting.json";
import { adminGuard, audit } from "../../../../lib/admin";
import { AdminError } from "../../../../lib/admin-content";
import { handle, json } from "../../../../lib/api";
import { getSchemaVersion } from "../../../../lib/db/schema";
import { getEnvBinding } from "../../../../lib/db/types";
import { deleteMedia, saveMedia, type R2Like } from "../../../../lib/media";

const r2Binding = (hosting as { r2?: string | null }).r2 ?? null;

export async function POST(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "editor", { mutating: true });
    if (!g.ok) return g.response;
    if ((await getSchemaVersion(g.db)) < 1) throw new AdminError("Apply the database upgrade first to upload images.", 409);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new AdminError("Choose an image to upload.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r2 = await getEnvBinding<R2Like>(r2Binding);
    const saved = await saveMedia(g.db, r2, { bytes, name: file.name }, g.admin.email, String(form?.get("alt") || ""));
    await audit(g.db, g.admin.email, "upload", "media", saved.id, { size: bytes.byteLength });
    return json({ ok: true, ...saved });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const id = new URL(request.url).searchParams.get("id") || "";
    await deleteMedia(g.db, await getEnvBinding<R2Like>(r2Binding), id);
    await audit(g.db, g.admin.email, "delete", "media", id);
    return json({ ok: true });
  });
}
