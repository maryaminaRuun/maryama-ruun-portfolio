import type { D1Like } from "./types";

/**
 * Database safety model
 * ---------------------
 * 1. LEGACY_TABLES is exactly what the September live site already creates.
 *    It only uses CREATE ... IF NOT EXISTS, so it never touches existing rows.
 * 2. Everything new (columns, tables, seeded content) is part of UPGRADE_V1 and
 *    is NEVER applied automatically. The owner must download a full SQL backup
 *    first and then confirm the upgrade in the Admin Dashboard. The upgrade
 *    request must carry the SHA-256 of a backup that matches the database's
 *    current state exactly (see lib/db/backup.ts and app/api/admin/upgrade).
 * 3. The upgrade is purely additive: ADD COLUMN and CREATE TABLE only. No
 *    DROP, no DELETE, no overwrite of existing values.
 */

export const LEGACY_TABLES: string[] = [
  "CREATE TABLE IF NOT EXISTS content_items (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS content_items_type_idx ON content_items(type)",
  "CREATE TABLE IF NOT EXISTS contact_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unread', created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS page_views (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, session_id TEXT NOT NULL, viewed_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS page_views_date_idx ON page_views(viewed_at)",
  "CREATE INDEX IF NOT EXISTS page_views_path_idx ON page_views(path)",
];

/** Columns added to existing tables by upgrade v1 (all nullable or defaulted). */
export const UPGRADE_V1_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "content_items", column: "slug", ddl: "slug TEXT" },
  { table: "content_items", column: "subtitle", ddl: "subtitle TEXT" },
  { table: "content_items", column: "body", ddl: "body TEXT" },
  { table: "content_items", column: "url", ddl: "url TEXT" },
  { table: "content_items", column: "url_label", ddl: "url_label TEXT" },
  { table: "content_items", column: "image", ddl: "image TEXT" },
  { table: "content_items", column: "featured", ddl: "featured INTEGER NOT NULL DEFAULT 0" },
  { table: "content_items", column: "sort_order", ddl: "sort_order INTEGER NOT NULL DEFAULT 0" },
  { table: "content_items", column: "meta", ddl: "meta TEXT NOT NULL DEFAULT '{}'" },
  { table: "content_items", column: "updated_at", ddl: "updated_at TEXT" },
  { table: "page_views", column: "referrer", ddl: "referrer TEXT" },
  { table: "page_views", column: "country", ddl: "country TEXT" },
  { table: "page_views", column: "device", ddl: "device TEXT" },
];

/** New tables created by upgrade v1. */
export const UPGRADE_V1_TABLES: string[] = [
  "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, applied_by TEXT NOT NULL, backup_sha256 TEXT)",
  "CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS admin_users (email TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'editor', created_at TEXT NOT NULL, created_by TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, storage TEXT NOT NULL, data BLOB, alt TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, detail TEXT, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS content_items_slug_idx ON content_items(type, slug)",
  "CREATE INDEX IF NOT EXISTS audit_log_date_idx ON audit_log(created_at)",
];

export const CURRENT_SCHEMA_VERSION = 1;

export async function ensureLegacyTables(db: D1Like): Promise<void> {
  await db.batch(LEGACY_TABLES.map((sql) => db.prepare(sql)));
}

export async function tableExists(db: D1Like, name: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(name)
    .first<{ name: string }>();
  return !!row;
}

export async function columnNames(db: D1Like, table: string): Promise<Set<string>> {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid table name");
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set(info.results.map((c) => c.name));
}

export async function getSchemaVersion(db: D1Like): Promise<number> {
  if (!(await tableExists(db, "schema_migrations"))) return 0;
  const row = await db
    .prepare("SELECT MAX(version) AS v FROM schema_migrations")
    .first<{ v: number | null }>();
  return Number(row?.v ?? 0);
}

/**
 * Additive schema changes for v1. Safe to run more than once: columns that
 * already exist are skipped, tables use IF NOT EXISTS.
 */
export async function applySchemaV1(db: D1Like): Promise<void> {
  for (const sql of UPGRADE_V1_TABLES.filter((s) => s.startsWith("CREATE TABLE"))) {
    await db.prepare(sql).run();
  }
  const cache = new Map<string, Set<string>>();
  for (const col of UPGRADE_V1_COLUMNS) {
    if (!cache.has(col.table)) cache.set(col.table, await columnNames(db, col.table));
    if (cache.get(col.table)!.has(col.column)) continue;
    await db.prepare(`ALTER TABLE ${col.table} ADD COLUMN ${col.ddl}`).run();
    cache.get(col.table)!.add(col.column);
  }
  for (const sql of UPGRADE_V1_TABLES.filter((s) => s.startsWith("CREATE INDEX"))) {
    await db.prepare(sql).run();
  }
}
