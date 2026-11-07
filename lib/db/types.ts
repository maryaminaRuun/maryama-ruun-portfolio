// A small SQLite statement interface (the subset of the Cloudflare D1 API the
// app was written against). Production uses Turso (libSQL) through
// `createLibsqlDb`; tests use Node's built-in SQLite (tests/helpers/sqlite-d1.ts).
// Keeping one interface means the backup, upgrade and admin logic is identical
// everywhere and was tested against real SQLite.

export type SqlValue = string | number | null | ArrayBuffer | Uint8Array;

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success?: boolean;
  meta?: { changes?: number; last_row_id?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: SqlValue[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedStatementLike;
  /** Runs every statement in ONE transaction: all succeed or none are applied. */
  batch(statements: D1PreparedStatementLike[]): Promise<D1Result[]>;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("The database is not configured. Connect a Turso database to this Vercel project (TURSO_DATABASE_URL and TURSO_AUTH_TOKEN).");
  }
}

/** Connection settings from the environment (names used by the Vercel Turso integration). */
export function databaseConfig(): { url: string; authToken?: string } | null {
  const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || process.env.DATABASE_URL;
  if (url) return { url, authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined };
  // Local development only: a file next to the project.
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) return { url: "file:local.db" };
  return null;
}

let cached: Promise<D1Like> | null = null;

export async function getEnvDb(): Promise<D1Like> {
  if (!cached) {
    cached = (async () => {
      const cfg = databaseConfig();
      if (!cfg) throw new DatabaseNotConfiguredError();
      const { createClient } = await import("@libsql/client");
      return createLibsqlDb(createClient({ url: cfg.url, authToken: cfg.authToken, intMode: "number" }));
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

// ---- libSQL adapter ----
type LibsqlValue = null | string | number | bigint | ArrayBuffer | Uint8Array | boolean;
type LibsqlResultSet = { columns: string[]; rows: ArrayLike<unknown>[]; rowsAffected: number; lastInsertRowid?: bigint | number };
export interface LibsqlClientLike {
  execute(stmt: { sql: string; args: LibsqlValue[] }): Promise<LibsqlResultSet>;
  batch(stmts: { sql: string; args: LibsqlValue[] }[], mode: "write"): Promise<LibsqlResultSet[]>;
}

function toArg(v: SqlValue): LibsqlValue {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

function rowObjects<T>(rs: LibsqlResultSet): T[] {
  return rs.rows.map((row) => {
    const o: Record<string, unknown> = {};
    rs.columns.forEach((c, i) => {
      const v = (row as Record<number, unknown>)[i];
      o[c] = typeof v === "bigint" ? Number(v) : v;
    });
    return o as T;
  });
}

function toResult(rs: LibsqlResultSet): D1Result {
  return { results: [], success: true, meta: { changes: rs.rowsAffected, last_row_id: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid) } };
}

type LibsqlStatement = D1PreparedStatementLike & { __stmt: { sql: string; args: LibsqlValue[] } };

export function createLibsqlDb(client: LibsqlClientLike): D1Like {
  const make = (sql: string, params: SqlValue[] = []): LibsqlStatement => {
    const stmt = { sql, args: params.map(toArg) };
    return {
      __stmt: stmt,
      bind: (...values: SqlValue[]) => make(sql, values),
      async first<T>() {
        const rs = await client.execute(stmt);
        return (rowObjects<T>(rs)[0] ?? null) as T | null;
      },
      async all<T>() {
        return { results: rowObjects<T>(await client.execute(stmt)), success: true };
      },
      async run() {
        return toResult(await client.execute(stmt));
      },
    };
  };
  return {
    prepare: (sql: string) => make(sql),
    async batch(statements) {
      if (!statements.length) return [];
      const results = await client.batch(statements.map((s) => (s as LibsqlStatement).__stmt), "write");
      return results.map(toResult);
    },
  };
}
