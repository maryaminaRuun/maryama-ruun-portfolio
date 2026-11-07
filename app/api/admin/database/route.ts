import { adminGuard, audit } from "../../../../lib/admin";
import { AdminError } from "../../../../lib/admin-content";
import { handle, json } from "../../../../lib/api";
import { importBackup, inspectBackup } from "../../../../lib/db/import";
import { initializeWithOriginalContent } from "../../../../lib/db/upgrade";

const MAX_IMPORT_BYTES = 4_000_000; // Vercel request bodies are limited to 4.5 MB

/**
 * Owner only. For a NEW, EMPTY database:
 *  - action=inspect: read a backup file and report what it contains (nothing written)
 *  - action=import:  import the backup (verified row by row)
 *  - action=init:    start with the original portfolio content instead
 * Both writing actions refuse to run if the database already has content.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const action = new URL(request.url).searchParams.get("action");
    if (action === "init") {
      const r = await initializeWithOriginalContent(g.db, g.admin.email);
      return json({ ok: true, report: r });
    }
    if (action === "inspect" || action === "import") {
      const len = Number(request.headers.get("content-length") || 0);
      if (len > MAX_IMPORT_BYTES) throw new AdminError("This backup is larger than 4 MB. Use `npm run backup:import` from a computer instead (see docs/VERCEL.md).", 413);
      const text = await request.text();
      if (text.length > MAX_IMPORT_BYTES) throw new AdminError("This backup is larger than 4 MB.", 413);
      if (action === "inspect") return json({ ok: true, ...(await inspectBackup(text)) });
      const report = await importBackup(g.db, text, g.admin.email);
      await audit(g.db, g.admin.email, "import-backup", "database", null, { verified: report.verified, rows: report.rowsImported });
      return json({ ok: report.verified, report }, report.verified ? 200 : 500);
    }
    throw new AdminError("Unknown action.");
  });
}
