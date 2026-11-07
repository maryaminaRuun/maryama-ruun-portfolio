import hosting from "../../../.openai/hosting.json";
import { tableExists } from "../../../lib/db/schema";
import { getEnvBinding, getEnvDb } from "../../../lib/db/types";
import { readMedia, type R2Like } from "../../../lib/media";

const r2Binding = (hosting as { r2?: string | null }).r2 ?? null;

/** Public image delivery for uploaded media. Ids are unique, so responses are cached forever. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const db = await getEnvDb();
    if (!(await tableExists(db, "media"))) return new Response("Not found", { status: 404 });
    const media = await readMedia(db, await getEnvBinding<R2Like>(r2Binding), id);
    if (!media) return new Response("Not found", { status: 404 });
    const body = media.bytes instanceof ArrayBuffer ? media.bytes : media.bytes.slice().buffer;
    return new Response(body, {
      headers: {
        "content-type": media.type,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
