import assert from "node:assert/strict";
import test from "node:test";
import { addEditor, AdminError, createItem, deleteRow, getDashboard, getItem, reorderItems, removeEditor, setItemFeatured, updateItem, updateSettings, validateItem } from "../lib/admin-content";
import { exportDatabase } from "../lib/db/backup";
import { ensureLegacyTables } from "../lib/db/schema";
import { applyUpgradeV1 } from "../lib/db/upgrade";
import { loadContentFrom, selectHomepageProjects } from "../lib/content";
import { deleteMedia, MAX_D1_BYTES, MediaError, readMedia, saveMedia, sniffImageType } from "../lib/media";
import { cleanUrl, isSameOrigin } from "../lib/security";
import { resolveRole as resolveRoleForTest } from "../lib/roles";
import { createSqliteD1 } from "./helpers/sqlite-d1";

async function upgradedDb() {
  const db = createSqliteD1();
  await ensureLegacyTables(db);
  await applyUpgradeV1(db, "owner@test", (await exportDatabase(db)).sha256);
  return db;
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);

test("legacy (pre-upgrade) CRUD still works with the original columns", async () => {
  const db = createSqliteD1();
  await ensureLegacyTables(db);
  const id = await createItem(db, { type: "service", title: "Mobile apps", description: "Flutter" });
  await updateItem(db, id, { title: "Mobile Apps", description: "Flutter & React Native", status: "draft" });
  const row = await getItem(db, id);
  assert.equal(row?.title, "Mobile Apps");
  assert.equal(row?.status, "draft");
  await deleteRow(db, "items", id);
  assert.equal(await getItem(db, id), null);
});

test("full CRUD for every public content type after upgrade", async () => {
  const db = await upgradedDb();
  for (const type of ["project", "service", "skill", "blog", "experience", "certificate", "testimonial"]) {
    const id = await createItem(db, { type, title: `New ${type}`, description: "d", meta: { items: "A, B", period: "2026", date: "Nov 7, 2026" }, url: "https://example.com", status: "published" });
    await updateItem(db, id, { title: `Edited ${type}`, description: "edited", meta: { items: ["X"] } });
    const row = await getItem(db, id);
    assert.equal(row?.title, `Edited ${type}`);
    assert.equal(row?.type, type, "type cannot be changed by an update");
  }
  const c = await loadContentFrom(db);
  assert.ok(c.services.some((s) => s.title === "Edited service" && s.items[0] === "X"));
  assert.ok(c.posts.some((p) => p.slug === "edited-blog" || p.slug === "new-blog"));
  assert.ok(c.testimonials.some((t) => t.title === "Edited testimonial"));
});

test("blog slugs are unique", async () => {
  const db = await upgradedDb();
  await assert.rejects(createItem(db, { type: "blog", title: "Another fintech post", slug: "designing-trustworthy-fintech" }), (e: unknown) => e instanceof AdminError && e.status === 409);
});

test("no more than six featured projects; homepage always shows exactly six", async () => {
  const db = await upgradedDb();
  await assert.rejects(createItem(db, { type: "project", title: "Seventh", featured: true }), /exactly 6 featured/);
  const id = await createItem(db, { type: "project", title: "Seventh", featured: false });
  await assert.rejects(setItemFeatured(db, id, true), /exactly 6/);
  const first = (await db.prepare("SELECT id FROM content_items WHERE type='project' AND featured=1 ORDER BY sort_order LIMIT 1").first<{ id: number }>())!.id;
  await setItemFeatured(db, first, false);
  await setItemFeatured(db, id, true);
  const home = selectHomepageProjects((await loadContentFrom(db)).projects);
  assert.equal(home.length, 6);
  assert.ok(home.some((p) => p.title === "Seventh"));
});

test("reorder changes public order", async () => {
  const db = await upgradedDb();
  const ids = (await db.prepare("SELECT id FROM content_items WHERE type='service' ORDER BY sort_order").all<{ id: number }>()).results.map((r) => r.id);
  await reorderItems(db, [...ids].reverse());
  const c = await loadContentFrom(db);
  assert.equal(c.services[0]!.title, "UI/UX & Visual Design");
});

test("validation rejects unsafe input", () => {
  assert.throws(() => validateItem({ type: "project", title: "" }), /Title is required/);
  assert.throws(() => validateItem({ type: "hacker", title: "x" }), /Unknown content type/);
  assert.throws(() => validateItem({ type: "project", title: "x", url: "javascript:alert(1)" }), /Link must start/);
  assert.throws(() => validateItem({ type: "project", title: "x", image: "javascript:alert(1)" }), /Image must be/);
  assert.equal(cleanUrl("//evil.com"), "");
  assert.equal(validateItem({ type: "project", title: "x", image: "/media/abc-123.png" }).image, "/media/abc-123.png");
});

test("settings: validated, persisted, and shown publicly", async () => {
  const db = await upgradedDb();
  await assert.rejects(updateSettings(db, { email: "not-an-email" }), /email/i);
  await assert.rejects(updateSettings(db, { linkedin_url: "javascript:x" }), /https/);
  await updateSettings(db, { linkedin_url: "https://www.linkedin.com/in/maryama-ruun", hero_lead: "New lead" });
  const c = await loadContentFrom(db);
  assert.equal(c.settings.linkedin_url, "https://www.linkedin.com/in/maryama-ruun");
  assert.equal(c.settings.hero_lead, "New lead");
});

test("roles: owner fixed, editors managed by owner", async () => {
  const db = await upgradedDb();
  assert.equal(await resolveRoleForTest(db, "RUUN4646@gmail.com"), "owner");
  assert.equal(await resolveRoleForTest(db, "editor@test.com"), null);
  await addEditor(db, "Editor@Test.com", "ruun4646@gmail.com");
  assert.equal(await resolveRoleForTest(db, "editor@test.com"), "editor");
  await assert.rejects(removeEditor(db, "ruun4646@gmail.com"), /owner cannot be removed/);
  await removeEditor(db, "editor@test.com");
  assert.equal(await resolveRoleForTest(db, "editor@test.com"), null);
});

test("editors cannot read contact messages via the dashboard", async () => {
  const db = await upgradedDb();
  await db.prepare("INSERT INTO contact_messages (name,email,subject,message,status,created_at) VALUES ('A','a@b.co','s','m','unread','2026-11-01T00:00:00Z')").run();
  assert.equal((await getDashboard(db, "editor")).messages.length, 0);
  assert.equal((await getDashboard(db, "owner")).messages.length, 1);
});

test("dashboard analytics work before and after upgrade", async () => {
  const db = createSqliteD1();
  await ensureLegacyTables(db);
  await db.prepare("INSERT INTO page_views (path, session_id, viewed_at) VALUES ('/', 's1', datetime('now'))").run();
  const before = await getDashboard(db, "owner", 7);
  assert.equal(before.analytics.daily.length, 7);
  assert.equal(Number((before.analytics.summary as { total: number }).total), 1);
  await applyUpgradeV1(db, "o", (await exportDatabase(db)).sha256);
  const after = await getDashboard(db, "owner", 30);
  assert.equal(after.analytics.daily.length, 30);
  assert.equal(after.schemaVersion, 1);
});

test("media: real image signatures only, size limit, safe delete", async () => {
  const db = await upgradedDb();
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)></svg>")), null);
  await assert.rejects(saveMedia(db, null, { bytes: new TextEncoder().encode("<html>not an image</html>"), name: "x.png" }, "o"), MediaError);
  const big = new Uint8Array(MAX_D1_BYTES + 1);
  big.set(PNG);
  await assert.rejects(saveMedia(db, null, { bytes: big, name: "big.png" }, "o"), /too large/);

  const saved = await saveMedia(db, null, { bytes: PNG, name: "shot.png" }, "o", "Screenshot");
  const read = await readMedia(db, null, saved.id);
  assert.deepEqual([...new Uint8Array(read!.bytes)], [...PNG]);
  const id = await createItem(db, { type: "project", title: "With image", image: saved.url });
  await assert.rejects(deleteMedia(db, null, saved.id), /still used/);
  await deleteRow(db, "items", id);
  await deleteMedia(db, null, saved.id);
  assert.equal(await readMedia(db, null, saved.id), null);
});

test("media: R2 storage path", async () => {
  const db = await upgradedDb();
  const store = new Map<string, Uint8Array>();
  const r2 = {
    async put(k: string, v: Uint8Array | ArrayBuffer) { store.set(k, v instanceof Uint8Array ? v : new Uint8Array(v)); },
    async get(k: string) { const v = store.get(k); return v ? { arrayBuffer: async () => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer } : null; },
    async delete(k: string) { store.delete(k); },
  };
  const saved = await saveMedia(db, r2, { bytes: PNG, name: "r2.png" }, "o");
  assert.equal(store.size, 1);
  const row = await db.prepare("SELECT storage, data FROM media WHERE id=?").bind(saved.id).first<{ storage: string; data: unknown }>();
  assert.equal(row?.storage, "r2");
  assert.equal(row?.data, null);
  assert.equal((await readMedia(db, r2, saved.id))!.bytes.byteLength, PNG.byteLength);
  await deleteMedia(db, r2, saved.id);
  assert.equal(store.size, 0);
});

test("same-origin check blocks cross-site writes", () => {
  const mk = (h: Record<string, string>) => new Request("https://site.example/api/admin/content", { method: "POST", headers: h });
  assert.equal(isSameOrigin(mk({ origin: "https://site.example", "sec-fetch-site": "same-origin" })), true);
  assert.equal(isSameOrigin(mk({ origin: "https://evil.example" })), false);
  assert.equal(isSameOrigin(mk({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(isSameOrigin(mk({})), false);
});
