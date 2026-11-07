import { adminGuard, audit } from "../../../../lib/admin";
import { AdminError } from "../../../../lib/admin-content";
import { handle, json } from "../../../../lib/api";
import { deleteMedia, getBlobStore, saveMedia } from "../../../../lib/media";

export async function POST(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "editor", { mutating: true });
    if (!g.ok) return g.response;
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") throw new AdminError("Choose an image to upload.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await saveMedia(g.db, await getBlobStore(), { bytes, name: file.name }, g.admin.email, String(form?.get("alt") || ""));
    await audit(g.db, g.admin.email, "upload", "media", saved.id, { size: bytes.byteLength });
    return json({ ok: true, ...saved });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const id = new URL(request.url).searchParams.get("id") || "";
    await deleteMedia(g.db, await getBlobStore(), id);
    await audit(g.db, g.admin.email, "delete", "media", id);
    return json({ ok: true });
  });
}
