// Test-only adapter: exposes Node's built-in SQLite with the subset of the
// Cloudflare D1 API that the app uses (prepare/bind/first/all/run/batch).
import { DatabaseSync } from "node:sqlite";
import type { D1Like, D1PreparedStatementLike, D1Result, SqlValue } from "../../lib/db/types";

function norm(v: SqlValue): string | number | null | Uint8Array {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

export function createSqliteD1(path = ":memory:"): D1Like & { raw: DatabaseSync } {
  const raw = new DatabaseSync(path);
  const make = (sql: string, params: SqlValue[] = []): D1PreparedStatementLike => ({
    bind: (...values: SqlValue[]) => make(sql, values),
    async first<T>() {
      const row = raw.prepare(sql).get(...params.map(norm));
      return row ? plain<T>(row) : null;
    },
    async all<T>() {
      return { results: raw.prepare(sql).all(...params.map(norm)).map((r) => plain<T>(r)), success: true } as D1Result<T>;
    },
    async run() {
      const info = raw.prepare(sql).run(...params.map(norm));
      return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  return {
    raw,
    prepare: (sql: string) => make(sql),
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const out: D1Result[] = [];
        for (const s of statements) out.push(await s.run());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
