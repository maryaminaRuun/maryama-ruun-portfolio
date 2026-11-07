import { ensureAppSchema, getDbState } from "./db/schema";
import { getEnvDb, type D1Like } from "./db/types";

/**
 * Returns the database with the full schema in place (CREATE IF NOT EXISTS and
 * missing columns only — existing rows are never changed).
 */
export async function ensurePortfolioTables(): Promise<D1Like> {
  const db = await getEnvDb();
  await ensureAppSchema(db);
  return db;
}

/** True once content has been imported or seeded. Before that, visitor data is not recorded. */
export async function isInitialized(db: D1Like): Promise<boolean> {
  return (await getDbState(db)) === "ready";
}
