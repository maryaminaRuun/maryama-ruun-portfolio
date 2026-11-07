// Run with: npm run test:db  (no build needed)
import assert from "node:assert/strict";
import test from "node:test";
import { exportDatabase } from "../lib/db/backup";
import { applySchemaV1, ensureLegacyTables, getSchemaVersion } from "../lib/db/schema";
import { applyUpgradeV1, UpgradeError } from "../lib/db/upgrade";
import { assembleContent, loadContentFrom, selectHomepageProjects } from "../lib/content";
import { projects as staticProjects } from "../app/site-data";
import { createSqliteD1 } from "./helpers/sqlite-d1";

/** A database shaped exactly like the live September site, with realistic rows. */
async function liveLikeDb() {
  const db = createSqliteD1();
  await ensureLegacyTables(db);
  const ins = (sql: string, ...v: (string | number)[]) => db.prepare(sql).bind(...v).run();
  await ins("INSERT INTO content_items (type,title,description,status,created_at) VALUES (?,?,?,?,?)", "service", "web develpment", "real solution", "published", "2026-10-01T10:00:00.000Z");
  await ins("INSERT INTO content_items (type,title,description,status,created_at) VALUES (?,?,?,?,?)", "project", "SomXchange", "Admin copy of an existing project", "draft", "2026-10-02T10:00:00.000Z");
  await ins("INSERT INTO content_items (type,title,description,status,created_at) VALUES (?,?,?,?,?)", "blog", "My first admin post", "Written in the old admin", "published", "2026-10-03T10:00:00.000Z");
  await ins("INSERT INTO content_items (type,title,description,status,created_at) VALUES (?,?,?,?,?)", "certificate", "Rise Academy MERN", "Full-stack course", "published", "2026-10-04T10:00:00.000Z");
  await ins("INSERT INTO contact_messages (name,email,subject,message,status,created_at) VALUES (?,?,?,?,?,?)", "Amina", "amina@example.com", "Website", "Hello 'quoted' text", "unread", "2026-10-05T10:00:00.000Z");
  await ins("INSERT INTO contact_messages (name,email,subject,message,status,created_at) VALUES (?,?,?,?,?,?)", "Omar", "omar@example.com", "App", "Line1\nLine2", "read", "2026-10-06T10:00:00.000Z");
  for (let i = 0; i < 25; i++) await ins("INSERT INTO page_views (path,session_id,viewed_at) VALUES (?,?,?)", i % 2 ? "/" : "/projects", `s${i % 7}`, `2026-11-0${(i % 6) + 1}T08:00:00.000Z`);
  return db;
}

const legacyColumns = "id, type, title, description, status, created_at";

test("backup exports every table and row, and restores to an identical database", async () => {
  const db = await liveLikeDb();
  const backup = await exportDatabase(db);
  assert.deepEqual(backup.counts, { contact_messages: 2, content_items: 4, page_views: 25 });
  assert.match(backup.sql, /Hello ''quoted'' text/);

  const restored = createSqliteD1();
  restored.raw.exec(backup.sql);
  const again = await exportDatabase(restored);
  assert.equal(again.sha256, backup.sha256, "restored database must be byte-identical in content");
});

test("backup is read-only and its hash is stable", async () => {
  const db = await liveLikeDb();
  const a = await exportDatabase(db);
  const b = await exportDatabase(db);
  assert.equal(a.sha256, b.sha256);
});

test("upgrade refuses without a matching backup and changes nothing", async () => {
  const db = await liveLikeDb();
  const before = await exportDatabase(db);
  await assert.rejects(applyUpgradeV1(db, "owner@test", "deadbeef"), (e: unknown) => e instanceof UpgradeError && e.code === "backup_mismatch");
  assert.equal((await exportDatabase(db)).sha256, before.sha256);
  assert.equal(await getSchemaVersion(db), 0);
});

test("upgrade refuses when data changed after the backup was taken", async () => {
  const db = await liveLikeDb();
  const backup = await exportDatabase(db);
  await db.prepare("INSERT INTO page_views (path,session_id,viewed_at) VALUES ('/', 'late', '2026-11-07T00:00:00.000Z')").run();
  await assert.rejects(applyUpgradeV1(db, "owner@test", backup.sha256), (e: unknown) => e instanceof UpgradeError && e.code === "backup_mismatch");
});

test("upgrade preserves every original row exactly and only adds", async () => {
  const db = await liveLikeDb();
  const originalItems = (await db.prepare(`SELECT ${legacyColumns} FROM content_items ORDER BY id`).all()).results;
  const originalMessages = (await db.prepare("SELECT * FROM contact_messages ORDER BY id").all()).results;
  const originalViews = (await db.prepare("SELECT id, path, session_id, viewed_at FROM page_views ORDER BY id").all()).results;
  const backup = await exportDatabase(db);

  const report = await applyUpgradeV1(db, "owner@test", backup.sha256);

  assert.equal(await getSchemaVersion(db), 1);
  assert.deepEqual((await db.prepare(`SELECT ${legacyColumns} FROM content_items WHERE id <= 4 ORDER BY id`).all()).results, originalItems);
  assert.deepEqual((await db.prepare("SELECT * FROM contact_messages ORDER BY id").all()).results, originalMessages);
  assert.deepEqual((await db.prepare("SELECT id, path, session_id, viewed_at FROM page_views ORDER BY id").all()).results, originalViews);
  for (const [table, n] of Object.entries(report.rowCountsBefore)) assert.ok(report.rowCountsAfter[table]! >= n, `${table} must not shrink`);

  // The old admin's SomXchange row is a draft, so the published original is still seeded.
  assert.equal(report.skippedExisting.project, undefined);
  assert.equal(report.inserted.project, staticProjects.length);
  assert.equal(report.legacySlugsAdded, 1);
  await assert.rejects(applyUpgradeV1(db, "owner@test", (await exportDatabase(db)).sha256), (e: unknown) => e instanceof UpgradeError && e.code === "already_applied");
});

test("a published duplicate made in the old admin is not seeded twice", async () => {
  const db = await liveLikeDb();
  await db.prepare("INSERT INTO content_items (type,title,description,status,created_at) VALUES ('project','Olow Tower','Edited copy','published','2026-10-09T00:00:00.000Z')").run();
  const report = await applyUpgradeV1(db, "owner@test", (await exportDatabase(db)).sha256);
  assert.equal(report.skippedExisting.project, 1);
  const n = await db.prepare("SELECT COUNT(*) AS n FROM content_items WHERE title='Olow Tower'").first<{ n: number }>();
  assert.equal(n!.n, 1);
});

test("schema v1 is idempotent", async () => {
  const db = await liveLikeDb();
  await applySchemaV1(db);
  await applySchemaV1(db);
  const cols = (await db.prepare("PRAGMA table_info(content_items)").all<{ name: string }>()).results.map((c) => c.name);
  assert.equal(new Set(cols).size, cols.length);
});

test("legacy mode reproduces the live site", async () => {
  const db = await liveLikeDb();
  const c = await loadContentFrom(db);
  assert.equal(c.mode, "legacy");
  assert.equal(c.services[0]!.title, "web develpment", "admin-added service is listed first, as on the live site");
  assert.equal(c.services.length, 5);
  assert.equal(selectHomepageProjects(c.projects).length, 6);
  assert.deepEqual(selectHomepageProjects(c.projects).map((p) => p.title), staticProjects.slice(0, 6).map((p) => p.title));
  assert.equal(c.posts.find((p) => p.featured)?.slug, "building-digniinai");
  assert.equal(c.settings.github_url, "https://github.com/maryaminaRuun");
  assert.equal(c.certificates.length, 1);
});

test("database mode after upgrade shows the same public content", async () => {
  const db = await liveLikeDb();
  const legacy = await loadContentFrom(db);
  await applyUpgradeV1(db, "owner@test", (await exportDatabase(db)).sha256);
  const c = await loadContentFrom(db);
  assert.equal(c.mode, "database");
  assert.deepEqual(c.services.map((s) => s.title), legacy.services.map((s) => s.title));
  assert.deepEqual(selectHomepageProjects(c.projects).map((p) => p.title), selectHomepageProjects(legacy.projects).map((p) => p.title));
  // The draft legacy copy is kept untouched; the published original is visible.
  const sx = (await db.prepare("SELECT status FROM content_items WHERE type='project' AND title='SomXchange' ORDER BY id").all<{ status: string }>()).results;
  assert.deepEqual(sx.map((r) => r.status), ["draft", "published"]);
  assert.equal(c.posts.length, 5, "4 original posts + 1 admin post");
  assert.ok(c.posts.every((p) => p.slug));
  assert.equal(c.skills.length, 4);
  assert.equal(c.experience.length, 3);
});

test("homepage always shows exactly six projects", () => {
  const base = assembleContent("static", [], []).projects;
  assert.equal(selectHomepageProjects(base).length, 6);
  const allFeatured = base.map((p) => ({ ...p, featured: true }));
  assert.equal(selectHomepageProjects(allFeatured).length, 6);
  const noneFeatured = base.map((p) => ({ ...p, featured: false }));
  assert.equal(selectHomepageProjects(noneFeatured).length, 6);
});
