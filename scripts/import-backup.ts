// Import a backup into the Turso database from a computer (for files over 4 MB).
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/import-backup.ts backup.sql
// Same checks as the admin: empty database only, file fingerprint, one transaction,
// row-by-row verification. Credentials come from the environment, never the command line.
import { readFileSync } from "node:fs";
import { importBackup } from "../lib/db/import";
import { ensureAppSchema } from "../lib/db/schema";
import { getEnvDb } from "../lib/db/types";

const file = process.argv[2];
if (!file || !process.env.TURSO_DATABASE_URL) {
  console.error("Usage: TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npx tsx scripts/import-backup.ts <backup.sql>");
  process.exit(2);
}
const db = await getEnvDb();
await ensureAppSchema(db);
const report = await importBackup(db, readFileSync(file, "utf8"), "import-script");
console.log(JSON.stringify(report, null, 2));
process.exit(report.verified ? 0 : 1);
