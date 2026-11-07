import type { D1Like } from "./types";

export type BackupResult = {
  sql: string;
  /** SHA-256 of the data section only (independent of the timestamp header). */
  sha256: string;
  counts: Record<string, number>;
  createdAt: string;
};

type MasterRow = { type: string; name: string; tbl_name: string; sql: string | null };

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) return Uint8Array.from(value as number[]);
  return null;
}

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  const bytes = toBytes(value);
  if (bytes) {
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return `X'${hex}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Read-only full export of every user table: schema, indexes and all rows.
 * Never writes to the database. Restorable with `sqlite3 new.db < backup.sql`
 * or `wrangler d1 execute <db> --file backup.sql` into an EMPTY database.
 */
export async function exportDatabase(db: D1Like): Promise<BackupResult> {
  const master = await db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
    )
    .all<MasterRow>();

  const tables = master.results.filter((r) => r.type === "table");
  const others = master.results.filter((r) => r.type !== "table");
  const counts: Record<string, number> = {};
  const body: string[] = [];

  for (const t of tables) {
    body.push(`-- Table: ${t.name}`);
    body.push(`${t.sql};`);
    const rows = await db.prepare(`SELECT * FROM ${quoteIdent(t.name)} ORDER BY rowid`).all<Record<string, unknown>>();
    counts[t.name] = rows.results.length;
    for (const row of rows.results) {
      const cols = Object.keys(row);
      body.push(
        `INSERT INTO ${quoteIdent(t.name)} (${cols.map(quoteIdent).join(", ")}) VALUES (${cols.map((c) => sqlLiteral(row[c])).join(", ")});`,
      );
    }
    body.push("");
  }
  for (const o of others) body.push(`${o.sql};`);

  const data = body.join("\n");
  const sha256 = await sha256Hex(data);
  const createdAt = new Date().toISOString();
  const header = [
    "-- Maryama Ruun Portfolio — full database backup",
    `-- Created: ${createdAt}`,
    `-- Data SHA-256: ${sha256}`,
    `-- Row counts: ${JSON.stringify(counts)}`,
    "-- Restore into an EMPTY database only. This file never deletes anything.",
    "",
  ].join("\n");

  return { sql: `${header}\n${data}\n`, sha256, counts, createdAt };
}
