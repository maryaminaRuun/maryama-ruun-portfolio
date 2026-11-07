import type { D1Like } from "./db/types";
import { cleanText } from "./security";

/** Image storage service (Vercel Blob in production; a fake in tests). */
export interface BlobStoreLike {
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<{ url: string }>;
  del(url: string): Promise<void>;
}

/** Vercel Blob, when a Blob store is connected to the project (BLOB_READ_WRITE_TOKEN). */
export async function getBlobStore(): Promise<BlobStoreLike | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const { put, del } = await import("@vercel/blob");
  return {
    async put(pathname, bytes, contentType) {
      const r = await put(pathname, Buffer.from(bytes), { access: "public", contentType, addRandomSuffix: true, cacheControlMaxAge: 31536000 });
      return { url: r.url };
    },
    async del(url) {
      await del(url);
    },
  };
}

export const MEDIA_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
/** Database storage keeps rows small; Blob uploads are capped by Vercel's 4.5 MB request limit. */
export const MAX_D1_BYTES = 1_900_000;
export const MAX_BLOB_BYTES = 4_000_000;

/** Verify the real file signature, not just the declared type (blocks HTML/SVG disguised as images). */
export function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /avi[fs]/.test(ascii(8, 12))) return "image/avif";
  return null;
}

export class MediaError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function saveMedia(db: D1Like, blob: BlobStoreLike | null, file: { bytes: Uint8Array; name: string }, actor: string, alt = ""): Promise<{ id: string; url: string }> {
  const type = sniffImageType(file.bytes);
  if (!type) throw new MediaError("Only JPEG, PNG, WebP, GIF or AVIF images can be uploaded.");
  const limit = blob ? MAX_BLOB_BYTES : MAX_D1_BYTES;
  if (file.bytes.byteLength > limit) throw new MediaError(`Image is too large (max ${(limit / 1_000_000).toFixed(1)} MB).`, 413);
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}.${MEDIA_TYPES[type]}`;
  const filename = cleanText(file.name, 160) || id;
  const stored = blob ? await blob.put(`media/${id}`, file.bytes, type) : null;
  await db
    .prepare("INSERT INTO media (id, filename, content_type, size, storage, data, alt, created_at, created_by, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, filename, type, file.bytes.byteLength, stored ? "blob" : "d1", stored ? null : file.bytes, cleanText(alt, 300), new Date().toISOString(), actor, stored?.url ?? null)
    .run();
  // Content always references the stable /media/<id> address; it serves or redirects.
  return { id, url: `/media/${id}` };
}

export type MediaRead = { redirect: string } | { bytes: ArrayBuffer | Uint8Array; type: string };

export async function readMedia(db: D1Like, id: string): Promise<MediaRead | null> {
  if (!/^[a-z0-9-]+\.(jpg|png|webp|gif|avif)$/.test(id)) return null;
  const row = await db.prepare("SELECT content_type, storage, data, url FROM media WHERE id = ?").bind(id).first<{ content_type: string; storage: string; data: unknown; url: string | null }>();
  if (!row) return null;
  if (row.storage === "blob") return row.url ? { redirect: row.url } : null;
  if (row.storage === "r2") return null; // images from the old Cloudflare R2 bucket are not reachable from Vercel
  const d = row.data;
  const bytes = d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : Array.isArray(d) ? Uint8Array.from(d as number[]) : null;
  return bytes ? { bytes, type: row.content_type } : null;
}

export async function deleteMedia(db: D1Like, blob: BlobStoreLike | null, id: string) {
  const row = await db.prepare("SELECT storage, url FROM media WHERE id = ?").bind(id).first<{ storage: string; url: string | null }>();
  if (!row) throw new MediaError("Image not found.", 404);
  const used = await db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE image = ?").bind(`/media/${id}`).first<{ n: number }>();
  if (Number(used?.n ?? 0) > 0) throw new MediaError("This image is still used by content. Replace it there first.", 409);
  if (row.storage === "blob" && row.url && blob) await blob.del(row.url);
  await db.prepare("DELETE FROM media WHERE id = ?").bind(id).run();
}
