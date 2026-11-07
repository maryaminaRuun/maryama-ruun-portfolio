// Staging rehearsal: run upgrade v1 against a COPY of a real backup, never the
// live database. Usage: npx --yes tsx scripts/rehearse-upgrade.ts backup.sql [out.db]
// Prints what would be added and proves every original row is unchanged.
import { readFileSync } from "node:fs";
import { exportDatabase } from "../lib/db/backup";
import { applyUpgradeV1 } from "../lib/db/upgrade";
import { loadContentFrom, selectHomepageProjects } from "../lib/content";
import { createSqliteD1 } from "../tests/helpers/sqlite-d1";

const [file, out = ":memory:"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx --yes tsx scripts/rehearse-upgrade.ts <backup.sql> [staging.db]");
  process.exit(2);
}
const db = createSqliteD1(out);
db.raw.exec(readFileSync(file, "utf8"));
const snapshot = (table: string, cols: string) => db.prepare(`SELECT ${cols} FROM ${table} ORDER BY id`).all().then((r) => JSON.stringify(r.results));
const before = {
  content: await snapshot("content_items", "id, type, title, description, status, created_at"),
  messages: await snapshot("contact_messages", "*"),
  views: await snapshot("page_views", "id, path, session_id, viewed_at"),
};
const legacy = await loadContentFrom(db);
const report = await applyUpgradeV1(db, "staging-rehearsal", (await exportDatabase(db)).sha256);
const after = {
  content: (await db.prepare("SELECT id, type, title, description, status, created_at FROM content_items WHERE id <= ? ORDER BY id").bind(JSON.parse(before.content).at(-1)?.id ?? 0).all()).results,
  messages: await snapshot("contact_messages", "*"),
  views: await snapshot("page_views", "id, path, session_id, viewed_at"),
};
const upgraded = await loadContentFrom(db);
const checks: [string, boolean][] = [
  ["original content rows unchanged", JSON.stringify(after.content) === before.content],
  ["contact messages unchanged", after.messages === before.messages],
  ["page views unchanged", after.views === before.views],
  ["homepage still shows 6 projects", selectHomepageProjects(upgraded.projects).length === 6],
  ["same homepage projects as before", JSON.stringify(selectHomepageProjects(upgraded.projects).map((p) => p.title)) === JSON.stringify(selectHomepageProjects(legacy.projects).map((p) => p.title))],
  ["same services as before", JSON.stringify(upgraded.services.map((s) => s.title)) === JSON.stringify(legacy.services.map((s) => s.title))],
];
console.log("Upgrade report:", JSON.stringify(report, null, 2));
for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log(`\nRehearsal passed${out !== ":memory:" ? ` — upgraded copy saved to ${out}` : ""}.`);
