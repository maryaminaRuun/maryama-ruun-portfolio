// Verify a backup downloaded from Admin → Database & backup.
// Usage: npx --yes tsx scripts/verify-backup.ts path/to/backup.sql
// Restores the file into a fresh in-memory SQLite database, re-exports it and
// checks that the SHA-256 and row counts match the header written at backup time.
import { readFileSync } from "node:fs";
import { exportDatabase } from "../lib/db/backup";
import { createSqliteD1 } from "../tests/helpers/sqlite-d1";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx --yes tsx scripts/verify-backup.ts <backup.sql>");
  process.exit(2);
}
const sql = readFileSync(file, "utf8");
const expectedSha = /-- Data SHA-256: ([0-9a-f]{64})/.exec(sql)?.[1];
const expectedCounts = JSON.parse(/-- Row counts: (\{.*\})/.exec(sql)?.[1] ?? "{}");
const db = createSqliteD1();
db.raw.exec(sql);
const again = await exportDatabase(db);
const countsOk = JSON.stringify(again.counts) === JSON.stringify(expectedCounts);
const shaOk = again.sha256 === expectedSha;
console.log(`File:        ${file}`);
console.log(`Row counts:  ${JSON.stringify(again.counts)} ${countsOk ? "✓ match" : "✗ MISMATCH"}`);
console.log(`SHA-256:     ${again.sha256} ${shaOk ? "✓ match" : "✗ MISMATCH"}`);
if (!countsOk || !shaOk) {
  console.error("\nBACKUP VERIFICATION FAILED — do not apply the upgrade with this file.");
  process.exit(1);
}
console.log("\nBackup verified: it restores completely into an empty database.");
