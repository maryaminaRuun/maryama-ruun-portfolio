// Minimal D1-compatible interfaces. Keeping our code typed against this subset
// lets the same logic run on Cloudflare D1 in production and on a local SQLite
// adapter in tests (see tests/db.test.ts).

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
  batch(statements: D1PreparedStatementLike[]): Promise<D1Result[]>;
}

export async function getEnvDb(): Promise<D1Like> {
  const { env } = await import("cloudflare:workers");
  const db = (env as unknown as { DB?: D1Like }).DB;
  if (!db) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return db;
}

export async function getEnvBinding<T>(name: string | null | undefined): Promise<T | null> {
  if (!name) return null;
  try {
    const { env } = await import("cloudflare:workers");
    return ((env as unknown as Record<string, T | undefined>)[name]) ?? null;
  } catch {
    return null;
  }
}
