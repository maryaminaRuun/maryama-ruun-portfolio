export async function ensurePortfolioTables() {
  const { env } = await import("cloudflare:workers");
  const db = env.DB;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS content_items (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS content_items_type_idx ON content_items(type)"),
    db.prepare("CREATE TABLE IF NOT EXISTS contact_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unread', created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS page_views (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, session_id TEXT NOT NULL, viewed_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS page_views_date_idx ON page_views(viewed_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS page_views_path_idx ON page_views(path)"),
  ]);
  return db;
}
