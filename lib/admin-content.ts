// Admin data operations. Pure database logic (no framework imports) so it can be
// tested against SQLite. Route handlers in app/api/admin/* call these.
import { defaultSettings, HOMEPAGE_PROJECT_COUNT, type SettingKey } from "../app/site-data";
import { slugify } from "./db/upgrade";
import { getSchemaVersion, tableExists } from "./db/schema";
import type { D1Like, SqlValue } from "./db/types";
import { cleanText, cleanUrl, EMAIL_RE } from "./security";
import { OWNER_EMAIL_LOWER } from "./owner";

export const CONTENT_TYPES = ["project", "service", "skill", "blog", "experience", "certificate", "testimonial", "profile", "setting"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
const TONES = ["indigo", "blue", "emerald", "amber", "rose", "violet"];

export class AdminError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type ItemInput = {
  type?: unknown; title?: unknown; description?: unknown; status?: unknown; subtitle?: unknown; slug?: unknown; body?: unknown;
  url?: unknown; url_label?: unknown; image?: unknown; featured?: unknown; sort_order?: unknown; meta?: unknown;
};

type CleanItem = {
  type: ContentType; title: string; description: string; status: "published" | "draft";
  subtitle: string | null; slug: string | null; body: string | null; url: string | null; url_label: string | null;
  image: string | null; featured: number; sort_order: number; meta: string;
};

function cleanImage(v: unknown): string | null {
  const s = cleanText(v, 500);
  if (!s) return null;
  if (/^\/(projects|media)\/[\w./-]+$/.test(s) || /^\/[\w-]+\.(png|jpe?g|webp|gif|avif)$/i.test(s)) return s;
  const u = cleanUrl(s);
  if (u.startsWith("https://")) return u;
  throw new AdminError("Image must be an uploaded image or an https:// link.");
}

function cleanMeta(type: ContentType, raw: unknown): Record<string, unknown> {
  const m = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const items = Array.isArray(m.items)
    ? m.items
    : typeof m.items === "string"
      ? m.items.split(/[,\n]/)
      : [];
  const cleanItems = items.map((x) => cleanText(x, 80)).filter(Boolean).slice(0, 30);
  if (type === "service" || type === "skill") out.items = cleanItems;
  if (type === "project") {
    if (typeof m.tone === "string" && TONES.includes(m.tone)) out.tone = m.tone;
    const mark = cleanText(m.mark, 4);
    if (mark) out.mark = mark;
  }
  if (type === "blog") {
    const date = cleanText(m.date, 40);
    const read = cleanText(m.read, 30);
    if (date) out.date = date;
    if (read) out.read = read;
  }
  if (type === "experience") {
    const period = cleanText(m.period, 60);
    if (period) out.period = period;
  }
  return out;
}

export function validateItem(input: ItemInput, partialType?: ContentType): CleanItem {
  const type = (partialType ?? cleanText(input.type, 30)) as ContentType;
  if (!CONTENT_TYPES.includes(type)) throw new AdminError("Unknown content type.");
  const title = cleanText(input.title, 200);
  if (!title) throw new AdminError("Title is required.");
  const status = input.status === "draft" ? "draft" : "published";
  const sort = Number(input.sort_order);
  const url = cleanUrl(input.url);
  if (cleanText(input.url, 500) && !url) throw new AdminError("Link must start with https://, http://, mailto: or /.");
  return {
    type, title, status,
    description: cleanText(input.description, 2000),
    subtitle: cleanText(input.subtitle, 120) || null,
    slug: type === "blog" ? slugify(cleanText(input.slug, 80) || title) : null,
    body: type === "blog" ? cleanText(input.body, 60000) || null : null,
    url: url || null,
    url_label: cleanText(input.url_label, 80) || null,
    image: cleanImage(input.image),
    featured: input.featured === true || input.featured === 1 || input.featured === "1" || input.featured === "on" ? 1 : 0,
    sort_order: Number.isFinite(sort) ? Math.max(-100000, Math.min(100000, Math.trunc(sort))) : 0,
    meta: JSON.stringify(cleanMeta(type, input.meta)),
  };
}

async function upgraded(db: D1Like) {
  return (await getSchemaVersion(db)) >= 1;
}

async function assertFeaturedCapacity(db: D1Like, item: CleanItem, excludeId?: number) {
  if (item.type !== "project" || !item.featured) return;
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM content_items WHERE type='project' AND featured=1 AND status='published' AND id != ?")
    .bind(excludeId ?? -1)
    .first<{ n: number }>();
  if (Number(row?.n ?? 0) >= HOMEPAGE_PROJECT_COUNT && item.status === "published") {
    throw new AdminError(`The homepage shows exactly ${HOMEPAGE_PROJECT_COUNT} featured projects. Un-feature one before featuring another.`, 409);
  }
}

async function assertUniqueSlug(db: D1Like, item: CleanItem, excludeId?: number) {
  if (item.type !== "blog" || !item.slug) return;
  const row = await db.prepare("SELECT id FROM content_items WHERE type='blog' AND slug = ? AND id != ?").bind(item.slug, excludeId ?? -1).first();
  if (row) throw new AdminError("Another post already uses this URL slug. Choose a different slug.", 409);
}

export async function createItem(db: D1Like, input: ItemInput): Promise<number> {
  const item = validateItem(input);
  const now = new Date().toISOString();
  if (!(await upgraded(db))) {
    // Before the upgrade only the original columns exist.
    const r = await db.prepare("INSERT INTO content_items(type,title,description,status,created_at) VALUES(?,?,?,?,?)").bind(item.type, item.title, item.description, item.status, now).run();
    return Number(r.meta?.last_row_id ?? 0);
  }
  await assertFeaturedCapacity(db, item);
  await assertUniqueSlug(db, item);
  const values: SqlValue[] = [item.type, item.title, item.description, item.status, now, item.slug, item.subtitle, item.body, item.url, item.url_label, item.image, item.featured, item.sort_order, item.meta, now];
  const r = await db
    .prepare("INSERT INTO content_items (type,title,description,status,created_at,slug,subtitle,body,url,url_label,image,featured,sort_order,meta,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(...values)
    .run();
  return Number(r.meta?.last_row_id ?? 0);
}

export async function getItem(db: D1Like, id: number) {
  return db.prepare("SELECT * FROM content_items WHERE id = ?").bind(id).first<Record<string, unknown> & { type: string }>();
}

export async function updateItem(db: D1Like, id: number, input: ItemInput): Promise<void> {
  const existing = await getItem(db, id);
  if (!existing) throw new AdminError("Item not found.", 404);
  const item = validateItem(input, existing.type as ContentType);
  if (!(await upgraded(db))) {
    await db.prepare("UPDATE content_items SET title=?, description=?, status=? WHERE id=?").bind(item.title, item.description, item.status, id).run();
    return;
  }
  await assertFeaturedCapacity(db, item, id);
  await assertUniqueSlug(db, item, id);
  await db
    .prepare("UPDATE content_items SET title=?, description=?, status=?, slug=?, subtitle=?, body=?, url=?, url_label=?, image=?, featured=?, sort_order=?, meta=?, updated_at=? WHERE id=?")
    .bind(item.title, item.description, item.status, item.slug, item.subtitle, item.body, item.url, item.url_label, item.image, item.featured, item.sort_order, item.meta, new Date().toISOString(), id)
    .run();
}

export async function setItemStatus(db: D1Like, id: number, status: unknown) {
  const s = status === "draft" ? "draft" : "published";
  await db.prepare("UPDATE content_items SET status=? WHERE id=?").bind(s, id).run();
}

export async function setItemFeatured(db: D1Like, id: number, featured: boolean) {
  if (!(await upgraded(db))) throw new AdminError("Apply the database upgrade first to manage featured projects.", 409);
  const existing = await getItem(db, id);
  if (!existing || existing.type !== "project") throw new AdminError("Project not found.", 404);
  if (featured) await assertFeaturedCapacity(db, { type: "project", featured: 1, status: existing.status === "draft" ? "draft" : "published" } as CleanItem, id);
  await db.prepare("UPDATE content_items SET featured=?, updated_at=? WHERE id=?").bind(featured ? 1 : 0, new Date().toISOString(), id).run();
}

export async function reorderItems(db: D1Like, ids: number[]) {
  if (!(await upgraded(db))) throw new AdminError("Apply the database upgrade first to reorder content.", 409);
  const clean = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (!clean.length) return;
  await db.batch(clean.map((id, i) => db.prepare("UPDATE content_items SET sort_order=? WHERE id=?").bind((i + 1) * 10, id)));
}

export async function deleteRow(db: D1Like, table: "items" | "messages", id: number) {
  const t = table === "messages" ? "contact_messages" : "content_items";
  await db.prepare(`DELETE FROM ${t} WHERE id = ?`).bind(id).run();
}

export async function setMessageStatus(db: D1Like, id: number, status: unknown) {
  await db.prepare("UPDATE contact_messages SET status=? WHERE id=?").bind(status === "unread" ? "unread" : "read", id).run();
}

// ---- Settings ----
export async function updateSettings(db: D1Like, values: Record<string, unknown>) {
  if (!(await upgraded(db))) throw new AdminError("Apply the database upgrade first to edit site text.", 409);
  const now = new Date().toISOString();
  const urlKeys = new Set(["github_url", "linkedin_url", "site_url"]);
  const writes = [];
  for (const key of Object.keys(defaultSettings) as SettingKey[]) {
    if (!(key in values)) continue;
    let v = cleanText(values[key], key === "bio" ? 4000 : 500);
    if (urlKeys.has(key) && v) {
      v = cleanUrl(v);
      if (!v.startsWith("http")) throw new AdminError(`${key.replace("_", " ")} must be a full https:// link.`);
    }
    if (key === "email" && !EMAIL_RE.test(v)) throw new AdminError("Contact email is not valid.");
    if (!v && !["linkedin_url"].includes(key)) throw new AdminError(`${key.replace(/_/g, " ")} cannot be empty.`);
    writes.push(db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(key, v, now));
  }
  if (writes.length) await db.batch(writes);
}

// ---- Users ----
export async function listUsers(db: D1Like) {
  if (!(await tableExists(db, "admin_users"))) return [];
  return (await db.prepare("SELECT email, role, created_at, created_by FROM admin_users ORDER BY created_at").all()).results;
}

export async function addEditor(db: D1Like, email: unknown, actor: string) {
  if (!(await upgraded(db))) throw new AdminError("Apply the database upgrade first to add editors.", 409);
  const e = cleanText(email, 200).toLowerCase();
  if (!EMAIL_RE.test(e)) throw new AdminError("Enter a valid email address.");
  if (e === OWNER_EMAIL_LOWER) throw new AdminError("That is the owner account.");
  await db.prepare("INSERT INTO admin_users (email, role, created_at, created_by) VALUES (?, 'editor', ?, ?) ON CONFLICT(email) DO NOTHING").bind(e, new Date().toISOString(), actor).run();
}

export async function removeEditor(db: D1Like, email: unknown) {
  const e = cleanText(email, 200).toLowerCase();
  if (e === OWNER_EMAIL_LOWER) throw new AdminError("The owner cannot be removed.");
  await db.prepare("DELETE FROM admin_users WHERE email = ?").bind(e).run();
}

// ---- Dashboard ----
export async function getDashboard(db: D1Like, role: "owner" | "editor", days = 30) {
  const version = await getSchemaVersion(db);
  const range = Math.min(90, Math.max(7, Math.trunc(days) || 30));
  const hasExtra = version >= 1;
  const q = <T>(sql: string, ...v: SqlValue[]) => db.prepare(sql).bind(...v).all<T>().then((r) => r.results);
  const [items, messages, summary, daily, pages, referrers, countries, devices, settings, media, users, auditRows] = await Promise.all([
    q("SELECT * FROM content_items ORDER BY " + (hasExtra ? "type, sort_order, id" : "id DESC")),
    role === "owner" ? q("SELECT * FROM contact_messages ORDER BY id DESC") : Promise.resolve([]),
    db.prepare("SELECT COUNT(*) total, COUNT(DISTINCT session_id) visitors, SUM(CASE WHEN date(viewed_at)=date('now') THEN 1 ELSE 0 END) today, SUM(CASE WHEN viewed_at >= datetime('now', ?) THEN 1 ELSE 0 END) inRange FROM page_views").bind(`-${range} days`).first(),
    q(`WITH RECURSIVE dates(day) AS (SELECT date('now', ?) UNION ALL SELECT date(day,'+1 day') FROM dates WHERE day < date('now')) SELECT dates.day, COUNT(page_views.id) views, COUNT(DISTINCT page_views.session_id) visitors FROM dates LEFT JOIN page_views ON date(page_views.viewed_at)=dates.day GROUP BY dates.day ORDER BY dates.day`, `-${range - 1} days`),
    q("SELECT path, COUNT(*) views FROM page_views WHERE viewed_at >= datetime('now', ?) GROUP BY path ORDER BY views DESC LIMIT 8", `-${range} days`),
    hasExtra ? q("SELECT COALESCE(referrer,'Direct') AS label, COUNT(*) views FROM page_views WHERE viewed_at >= datetime('now', ?) GROUP BY label ORDER BY views DESC LIMIT 6", `-${range} days`) : Promise.resolve([]),
    hasExtra ? q("SELECT COALESCE(country,'Unknown') AS label, COUNT(*) views FROM page_views WHERE viewed_at >= datetime('now', ?) GROUP BY label ORDER BY views DESC LIMIT 6", `-${range} days`) : Promise.resolve([]),
    hasExtra ? q("SELECT COALESCE(device,'Unknown') AS label, COUNT(*) views FROM page_views WHERE viewed_at >= datetime('now', ?) GROUP BY label ORDER BY views DESC", `-${range} days`) : Promise.resolve([]),
    hasExtra ? q("SELECT key, value FROM site_settings") : Promise.resolve([]),
    hasExtra ? q("SELECT id, filename, content_type, size, alt, created_at, created_by FROM media ORDER BY created_at DESC LIMIT 200") : Promise.resolve([]),
    role === "owner" ? listUsers(db) : Promise.resolve([]),
    hasExtra && role === "owner" ? q("SELECT actor, action, entity, entity_id, created_at FROM audit_log ORDER BY id DESC LIMIT 25") : Promise.resolve([]),
  ]);
  return {
    schemaVersion: version,
    items, messages,
    analytics: { range, summary, daily, pages, referrers, countries, devices },
    settings: { ...defaultSettings, ...Object.fromEntries((settings as { key: string; value: string }[]).map((s) => [s.key, s.value])) },
    media, users, audit: auditRows,
  };
}
