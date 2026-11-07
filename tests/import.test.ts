import assert from "node:assert/strict";
import test from "node:test";
import { exportDatabase } from "../lib/db/backup";
import { importBackup, ImportError, parseValues, splitStatements } from "../lib/db/import";
import { ensureAppSchema, ensureLegacyTables, getDbState, getSchemaVersion } from "../lib/db/schema";
import { applyUpgradeV1, initializeWithOriginalContent } from "../lib/db/upgrade";
import { loadContentFrom, selectHomepageProjects } from "../lib/content";
import { saveMedia } from "../lib/media";
import { createSqliteD1 } from "./helpers/sqlite-d1";

/** The live ChatGPT Sites database shape (v0) with realistic rows, including tricky text. */
async function liveV0() {
  const db = createSqliteD1();
  await ensureLegacyTables(db);
  const ins = (sql: string, ...v: (string | number)[]) => db.prepare(sql).bind(...v).run();
  await ins("INSERT INTO content_items (type,title,description,status,created_at) VALUES (?,?,?,?,?)", "service", "web develpment", "real solution", "published", "2026-10-01T10:00:00.000Z");
  await ins("INSERT INTO content_items (type,title,description,status,created_at) VALUES (?,?,?,?,?)", "blog", "Old admin post; with semicolon", "It's -- tricky", "published", "2026-10-03T10:00:00.000Z");
  await ins("INSERT INTO contact_messages (name,email,subject,message,status,created_at) VALUES (?,?,?,?,?,?)", "Amina", "amina@example.com", "Hi; there", "Line1\nLine2 'quoted' ; -- not a comment\n\nLine4", "unread", "2026-10-05T10:00:00.000Z");
  for (let i = 0; i < 40; i++) await ins("INSERT INTO page_views (path,session_id,viewed_at) VALUES (?,?,?)", i % 2 ? "/" : "/blog", `s${i % 9}`, `2026-11-0${(i % 6) + 1}T08:00:00.000Z`);
  return db;
}

async function freshVercelDb() {
  const db = createSqliteD1();
  await ensureAppSchema(db);
  return db;
}

test("statement splitter and value parser handle quotes, semicolons, newlines and blobs", () => {
  assert.deepEqual(splitStatements("-- c\nA 'x;y';\nB 'it''s';"), ["A 'x;y'", "B 'it''s'"]);
  assert.deepEqual(parseValues("1, NULL, 'a''b', X'0aff', -2.5"), [1, null, "a'b", Uint8Array.from([10, 255]), -2.5]);
  assert.throws(() => parseValues("(SELECT 1)"), ImportError);
});

test("fresh Vercel database starts uninitialized and shows the original site", async () => {
  const db = await freshVercelDb();
  assert.equal(await getDbState(db), "uninitialized");
  const c = await loadContentFrom(db);
  assert.equal(selectHomepageProjects(c.projects).length, 6);
  assert.equal(c.services.length, 4);
});

test("import a v0 (live ChatGPT Sites) backup: every row verified, then original content added", async () => {
  const live = await liveV0();
  const backup = await exportDatabase(live);
  const db = await freshVercelDb();
  const report = await importBackup(db, backup.sql, "ruun4646@gmail.com");
  assert.equal(report.verified, true, report.mismatches.join("; "));
  assert.deepEqual(report.rowsImported, { content_items: 2, contact_messages: 1, page_views: 40 });
  assert.equal(await getSchemaVersion(db), 1);
  const msg = await db.prepare("SELECT message FROM contact_messages WHERE id=1").first<{ message: string }>();
  assert.equal(msg!.message, "Line1\nLine2 'quoted' ; -- not a comment\n\nLine4");
  const c = await loadContentFrom(db);
  assert.equal(c.services[0]!.title, "web develpment", "live order preserved: admin-added service first");
  assert.ok(c.posts.some((p) => p.title === "Old admin post; with semicolon" && p.slug));
  assert.equal(selectHomepageProjects(c.projects).length, 6);
});

test("import a v1 backup (with settings and DB-stored images) round-trips exactly", async () => {
  const src = await liveV0();
  await applyUpgradeV1(src, "o", (await exportDatabase(src)).sha256);
  await src.prepare("UPDATE site_settings SET value='https://www.linkedin.com/in/x' WHERE key='linkedin_url'").run();
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 255]);
  await saveMedia(src, null, { bytes: PNG, name: "p.png" }, "o");
  const backup = await exportDatabase(src);

  const db = await freshVercelDb();
  const report = await importBackup(db, backup.sql, "o");
  assert.equal(report.verified, true, report.mismatches.join("; "));
  assert.equal(report.sourceVersion, 1);
  assert.deepEqual(report.seededOriginalContent, {}, "v1 backup already has content: nothing re-seeded");
  const again = await exportDatabase(db);
  for (const t of Object.keys(backup.counts)) assert.ok(again.counts[t]! >= backup.counts[t]!, t);
  const c = await loadContentFrom(db);
  assert.equal(c.settings.linkedin_url, "https://www.linkedin.com/in/x");
});

test("import refuses a non-empty database, a tampered file, and foreign SQL", async () => {
  const live = await liveV0();
  const backup = await exportDatabase(live);

  const used = await freshVercelDb();
  await initializeWithOriginalContent(used, "o");
  await assert.rejects(importBackup(used, backup.sql, "o"), /empty database/);

  const db = await freshVercelDb();
  const tampered = backup.sql.replace("real solution", "fake solution");
  await assert.rejects(importBackup(db, tampered, "o"), /fingerprint/);
  assert.equal(await getDbState(db), "uninitialized", "nothing written");

  await assert.rejects(importBackup(db, "DROP TABLE content_items;", "o"), /not a backup/);
  const evil = backup.sql.replace(/\n\n/, "\n\nDROP TABLE contact_messages;\n");
  await assert.rejects(importBackup(db, evil, "o"), ImportError);
  assert.equal(await getDbState(db), "uninitialized");
});

test("backups never contain login data", async () => {
  const db = await freshVercelDb();
  await initializeWithOriginalContent(db, "o");
  await db.prepare("INSERT INTO admin_accounts (email,password_hash,totp_secret,created_at,updated_at) VALUES ('a@b.c','pbkdf2$x','enc','t','t')").run();
  await db.prepare("INSERT INTO admin_sessions (id_hash,email,created_at,expires_at,last_seen_at) VALUES ('h','a@b.c',1,2,1)").run();
  const b = await exportDatabase(db);
  assert.ok(!/admin_accounts|admin_sessions|pbkdf2/.test(b.sql));
});

test("start with original content only on an empty database", async () => {
  const db = await freshVercelDb();
  const r = await initializeWithOriginalContent(db, "o");
  assert.equal(r.inserted.project, 10);
  await assert.rejects(initializeWithOriginalContent(db, "o"), /already has content/);
});
