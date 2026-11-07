// Import a backup produced by exportDatabase (Admin → Database & backup, or the
// ChatGPT Sites version of the admin) into a database that has no content yet.
//
// Safety:
// - The file is never executed as SQL. It is parsed; only `INSERT INTO "<table>"`
//   rows for known tables and existing columns are accepted, and every value is
//   bound as a parameter. CREATE statements are skipped (the schema already exists).
// - The file's own SHA-256 (in its header) is recomputed first: a truncated or
//   edited file is rejected before anything is written.
// - Refuses to run unless the target has no content and no messages.
// - All rows are written in ONE transaction, then every imported row is read back
//   and compared with the file, value by value.
import { exportDatabase, sqlLiteral } from "./backup";
import { columnNames, getDbState, getSchemaVersion, SECRET_TABLES } from "./schema";
import type { D1Like, D1PreparedStatementLike, SqlValue } from "./types";
import { buildV1Writes } from "./upgrade";

export const IMPORTABLE_TABLES = ["content_items", "contact_messages", "page_views", "site_settings", "media", "admin_users", "audit_log", "schema_migrations"];

export class ImportError extends Error {}

type ParsedInsert = { table: string; columns: string[]; values: SqlValue[] };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Split SQL text into statements on `;` outside single-quoted strings, dropping `--` comment lines. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (!inStr && ch === "-" && sql[i + 1] === "-" && cur.trim() === "") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (ch === "'") {
      if (inStr && sql[i + 1] === "'") {
        cur += "''";
        i++;
        continue;
      }
      inStr = !inStr;
    }
    if (ch === ";" && !inStr) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (inStr) throw new ImportError("The backup file ends inside a text value — it looks truncated.");
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Parse a literal list: NULL, integers, decimals, 'text' (with '' escapes) and X'hex' blobs only. */
export function parseValues(src: string): SqlValue[] {
  const values: SqlValue[] = [];
  let i = 0;
  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };
  while (true) {
    skipWs();
    if (src.startsWith("NULL", i)) {
      values.push(null);
      i += 4;
    } else if (src[i] === "'") {
      let s = "";
      i++;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          break;
        }
        s += src[i];
        i++;
      }
      if (src[i] !== "'") throw new ImportError("Unterminated text value in backup.");
      i++;
      values.push(s);
    } else if ((src[i] === "X" || src[i] === "x") && src[i + 1] === "'") {
      const end = src.indexOf("'", i + 2);
      const hex = src.slice(i + 2, end);
      if (end < 0 || !/^([0-9a-fA-F]{2})*$/.test(hex)) throw new ImportError("Invalid binary value in backup.");
      const bytes = new Uint8Array(hex.length / 2);
      for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.slice(k * 2, k * 2 + 2), 16);
      values.push(bytes);
      i = end + 1;
    } else {
      const m = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ImportError("The backup contains a value that is not a plain literal. Only files produced by this site's backup can be imported.");
      values.push(Number(m[0]));
      i += m[0].length;
    }
    skipWs();
    if (i >= src.length) break;
    if (src[i] !== ",") throw new ImportError("Malformed value list in backup.");
    i++;
  }
  return values;
}

const INSERT_RE = /^INSERT INTO "([a-z][a-z0-9_]*)" \(((?:"[a-z][a-z0-9_]*"(?:, )?)+)\) VALUES \(([\s\S]*)\)$/;

export type ParsedBackup = {
  inserts: ParsedInsert[];
  counts: Record<string, number>;
  headerSha: string;
  fileShaOk: boolean;
  sourceVersion: number;
  skipped: Record<string, number>;
};

export async function parseBackup(sql: string): Promise<ParsedBackup> {
  const headerSha = /-- Data SHA-256: ([0-9a-f]{64})/.exec(sql)?.[1];
  const countsText = /-- Row counts: (\{.*\})/.exec(sql)?.[1];
  if (!headerSha || !countsText || !sql.startsWith("-- Maryama Ruun Portfolio")) {
    throw new ImportError("This file is not a backup made by the portfolio admin.");
  }
  const counts = JSON.parse(countsText) as Record<string, number>;
  // The data section is everything after the header's blank line, minus the final newline.
  const headerEnd = sql.indexOf("\n\n");
  const data = sql.slice(headerEnd + 2).replace(/\n$/, "");
  const fileShaOk = (await sha256Hex(data)) === headerSha;

  const inserts: ParsedInsert[] = [];
  const skipped: Record<string, number> = {};
  for (const stmt of splitStatements(sql)) {
    if (/^CREATE (TABLE|INDEX|UNIQUE INDEX)\b/i.test(stmt)) continue;
    const m = INSERT_RE.exec(stmt);
    if (!m) throw new ImportError(`Unexpected statement in backup: ${stmt.slice(0, 60)}…`);
    const table = m[1]!;
    if (SECRET_TABLES.has(table) || !IMPORTABLE_TABLES.includes(table)) {
      skipped[table] = (skipped[table] ?? 0) + 1;
      continue;
    }
    const columns = m[2]!.split(", ").map((c) => c.slice(1, -1));
    const values = parseValues(m[3]!);
    if (values.length !== columns.length) throw new ImportError(`Column/value count mismatch in ${table}.`);
    inserts.push({ table, columns, values });
  }
  const sourceVersion = inserts.some((r) => r.table === "schema_migrations") ? 1 : 0;
  return { inserts, counts, headerSha, fileShaOk, sourceVersion, skipped };
}

export type ImportReport = {
  rowsImported: Record<string, number>;
  expectedCounts: Record<string, number>;
  verified: boolean;
  mismatches: string[];
  sourceVersion: number;
  seededOriginalContent: Record<string, number>;
  missingImages: string[];
  skippedTables: Record<string, number>;
  backupSha256: string;
};

/** Read back every imported row and compare it with the file (same literal encoding as the backup). */
async function verifyImported(db: D1Like, inserts: ParsedInsert[]): Promise<string[]> {
  const mismatches: string[] = [];
  const byTable = new Map<string, ParsedInsert[]>();
  for (const r of inserts) byTable.set(r.table, [...(byTable.get(r.table) ?? []), r]);
  for (const [table, rows] of byTable) {
    const cols = rows[0]!.columns;
    const keyCol = cols.includes("id") ? "id" : cols.includes("key") ? "key" : cols.includes("email") ? "email" : cols.includes("version") ? "version" : null;
    if (!keyCol) {
      mismatches.push(`${table}: no key column to verify`);
      continue;
    }
    for (const r of rows) {
      const key = r.values[r.columns.indexOf(keyCol)]!;
      const got = await db
        .prepare(`SELECT ${r.columns.map((c) => `"${c}"`).join(", ")} FROM "${table}" WHERE "${keyCol}" = ?`)
        .bind(key)
        .first<Record<string, unknown>>();
      if (!got) {
        mismatches.push(`${table} ${keyCol}=${String(key)} missing`);
        continue;
      }
      for (let k = 0; k < r.columns.length; k++) {
        if (sqlLiteral(got[r.columns[k]!]) !== sqlLiteral(r.values[k])) {
          mismatches.push(`${table} ${keyCol}=${String(key)} column ${r.columns[k]} differs`);
          break;
        }
      }
      if (mismatches.length > 20) return mismatches;
    }
  }
  return mismatches;
}

export async function importBackup(db: D1Like, sqlText: string, actor: string): Promise<ImportReport> {
  if ((await getDbState(db)) !== "uninitialized") {
    throw new ImportError("This database already has content or messages. Import only works on a new, empty database, so nothing can be overwritten.");
  }
  const parsed = await parseBackup(sqlText);
  if (!parsed.fileShaOk) throw new ImportError("The backup file's fingerprint (SHA-256) does not match its contents. It may be incomplete or edited. Nothing was imported.");

  // Every column must already exist in the target table.
  const tableCols = new Map<string, Set<string>>();
  for (const r of parsed.inserts) {
    if (!tableCols.has(r.table)) tableCols.set(r.table, await columnNames(db, r.table));
    for (const c of r.columns) if (!tableCols.get(r.table)!.has(c)) throw new ImportError(`Backup column ${r.table}.${c} is unknown to this version of the site.`);
  }

  // Analytics recorded on the new site before import would clash with imported ids.
  const pv = await db.prepare("SELECT COUNT(*) AS n FROM page_views").first<{ n: number }>();
  if (Number(pv?.n ?? 0) > 0 && parsed.inserts.some((r) => r.table === "page_views")) {
    throw new ImportError("This database already recorded page views. Import into a new, empty database.");
  }

  const writes: D1PreparedStatementLike[] = parsed.inserts.map((r) =>
    db.prepare(`INSERT INTO "${r.table}" (${r.columns.map((c) => `"${c}"`).join(", ")}) VALUES (${r.columns.map(() => "?").join(", ")})`).bind(...r.values),
  );
  await db.batch(writes);

  const mismatches = await verifyImported(db, parsed.inserts);
  const rowsImported: Record<string, number> = {};
  for (const r of parsed.inserts) rowsImported[r.table] = (rowsImported[r.table] ?? 0) + 1;
  for (const [table, n] of Object.entries(parsed.counts)) {
    if (SECRET_TABLES.has(table) || !IMPORTABLE_TABLES.includes(table)) continue;
    if ((rowsImported[table] ?? 0) !== n) mismatches.push(`${table}: expected ${n} rows, imported ${rowsImported[table] ?? 0}`);
  }

  // A backup from the original (v0) site gets the same additive v1 step as the upgrade.
  let seeded: Record<string, number> = {};
  if (!mismatches.length && (await getSchemaVersion(db)) < 1) {
    const plan = await buildV1Writes(db, actor, "vercel_import_v0_backup", parsed.headerSha);
    await db.batch(plan.writes);
    seeded = plan.inserted;
  } else if (!mismatches.length) {
    await db
      .prepare("INSERT INTO audit_log (actor, action, entity, entity_id, detail, created_at) VALUES (?, 'import', 'database', NULL, ?, ?)")
      .bind(actor, JSON.stringify({ rowsImported, backupSha256: parsed.headerSha }), new Date().toISOString())
      .run();
  }

  const r2Media = parsed.inserts
    .filter((r) => r.table === "media" && r.values[r.columns.indexOf("storage")] === "r2")
    .map((r) => String(r.values[r.columns.indexOf("id")]));

  return {
    rowsImported,
    expectedCounts: parsed.counts,
    verified: mismatches.length === 0,
    mismatches,
    sourceVersion: parsed.sourceVersion,
    seededOriginalContent: seeded,
    missingImages: r2Media,
    skippedTables: parsed.skipped,
    backupSha256: parsed.headerSha,
  };
}

/** Convenience used by the admin to show what a file contains before importing. */
export async function inspectBackup(sqlText: string) {
  const p = await parseBackup(sqlText);
  return { counts: p.counts, fileShaOk: p.fileShaOk, sourceVersion: p.sourceVersion, sha256: p.headerSha };
}

export { exportDatabase };
