import type { D1Like } from "./db/types";
import { cleanText } from "./security";

/** Minimal R2 bucket surface we use. */
export interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
}

export const MEDIA_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
/** D1 stores at most ~2 MB per row; R2 has no practical limit for our use. */
export const MAX_D1_BYTES = 1_900_000;
export const MAX_R2_BYTES = 8_000_000;

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

export async function saveMedia(db: D1Like, r2: R2Like | null, file: { bytes: Uint8Array; name: string }, actor: string, alt = ""): Promise<{ id: string; url: string }> {
  const type = sniffImageType(file.bytes);
  if (!type) throw new MediaError("Only JPEG, PNG, WebP, GIF or AVIF images can be uploaded.");
  const limit = r2 ? MAX_R2_BYTES : MAX_D1_BYTES;
  if (file.bytes.byteLength > limit) throw new MediaError(`Image is too large (max ${(limit / 1_000_000).toFixed(1)} MB).`, 413);
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}.${MEDIA_TYPES[type]}`;
  const filename = cleanText(file.name, 160) || id;
  if (r2) {
    await r2.put(`media/${id}`, file.bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  }
  await db
    .prepare("INSERT INTO media (id, filename, content_type, size, storage, data, alt, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, filename, type, file.bytes.byteLength, r2 ? "r2" : "d1", r2 ? null : file.bytes, cleanText(alt, 300), new Date().toISOString(), actor)
    .run();
  return { id, url: `/media/${id}` };
}

export async function readMedia(db: D1Like, r2: R2Like | null, id: string): Promise<{ bytes: ArrayBuffer | Uint8Array; type: string } | null> {
  if (!/^[a-z0-9-]+\.(jpg|png|webp|gif|avif)$/.test(id)) return null;
  const row = await db.prepare("SELECT content_type, storage, data FROM media WHERE id = ?").bind(id).first<{ content_type: string; storage: string; data: unknown }>();
  if (!row) return null;
  if (row.storage === "r2") {
    if (!r2) return null;
    const obj = await r2.get(`media/${id}`);
    return obj ? { bytes: await obj.arrayBuffer(), type: row.content_type } : null;
  }
  const d = row.data;
  const bytes = d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : Array.isArray(d) ? Uint8Array.from(d as number[]) : null;
  return bytes ? { bytes, type: row.content_type } : null;
}

export async function deleteMedia(db: D1Like, r2: R2Like | null, id: string) {
  const row = await db.prepare("SELECT storage FROM media WHERE id = ?").bind(id).first<{ storage: string }>();
  if (!row) throw new MediaError("Image not found.", 404);
  const used = await db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE image = ?").bind(`/media/${id}`).first<{ n: number }>();
  if (Number(used?.n ?? 0) > 0) throw new MediaError("This image is still used by content. Replace it there first.", 409);
  if (row.storage === "r2" && r2) await r2.delete(`media/${id}`);
  await db.prepare("DELETE FROM media WHERE id = ?").bind(id).run();
}
