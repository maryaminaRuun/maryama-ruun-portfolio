import { tableExists } from "../../../lib/db/schema";
import { getEnvDb } from "../../../lib/db/types";
import { readMedia } from "../../../lib/media";

/** Stable image address. Blob images redirect to Vercel Blob; images stored in the database are served directly. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const db = await getEnvDb();
    if (!(await tableExists(db, "media"))) return new Response("Not found", { status: 404 });
    const media = await readMedia(db, id);
    if (!media) return new Response("Not found", { status: 404 });
    if ("redirect" in media) {
      return new Response(null, { status: 308, headers: { location: media.redirect, "cache-control": "public, max-age=31536000, immutable" } });
    }
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
