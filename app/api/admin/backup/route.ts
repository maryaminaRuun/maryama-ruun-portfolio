import { adminGuard } from "../../../../lib/admin";
import { handle } from "../../../../lib/api";
import { exportDatabase } from "../../../../lib/db/backup";

/** Owner-only, read-only full database export (schema + every row) as a .sql download. */
export async function GET(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner");
    if (!g.ok) return g.response;
    const backup = await exportDatabase(g.db);
    const stamp = backup.createdAt.replace(/[:.]/g, "-");
    return new Response(backup.sql, {
      headers: {
        "content-type": "application/sql; charset=utf-8",
        "content-disposition": `attachment; filename="maryama-portfolio-backup-${stamp}.sql"`,
        "cache-control": "no-store",
        "x-backup-sha256": backup.sha256,
        "x-backup-counts": JSON.stringify(backup.counts),
      },
    });
  });
}
