import { ensureLegacyTables } from "./db/schema";
import { getEnvDb, type D1Like } from "./db/types";

/**
 * Returns the D1 database after making sure the original (legacy) tables exist.
 * This is exactly the behaviour of the September live site: CREATE IF NOT EXISTS
 * only. Schema upgrades are never applied here — see lib/db/upgrade.ts.
 */
export async function ensurePortfolioTables(): Promise<D1Like> {
  const db = await getEnvDb();
  await ensureLegacyTables(db);
  return db;
}
