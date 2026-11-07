import { defaultSettings, experience, featuredPostSlug, HOMEPAGE_PROJECT_COUNT, posts, projects, services, skillGroups } from "../../app/site-data";
import { exportDatabase } from "./backup";
import { applySchemaV1, ensureLegacyTables, getDbState, getSchemaVersion } from "./schema";
import type { D1Like, D1PreparedStatementLike, SqlValue } from "./types";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

type SeedRow = {
  type: string;
  title: string;
  description: string;
  subtitle?: string | null;
  slug?: string | null;
  body?: string | null;
  url?: string | null;
  url_label?: string | null;
  image?: string | null;
  featured?: number;
  sort_order: number;
  meta?: Record<string, unknown>;
};

/** The original portfolio content, expressed as content_items rows. */
export function buildSeedRows(): SeedRow[] {
  const rows: SeedRow[] = [];
  projects.forEach((p, i) =>
    rows.push({
      type: "project", title: p.title, description: p.desc, subtitle: p.tag, url: p.url, url_label: p.label,
      image: p.image, featured: i < HOMEPAGE_PROJECT_COUNT ? 1 : 0, sort_order: (i + 1) * 10, meta: { tone: p.tone, mark: p.mark },
    }),
  );
  services.forEach((s, i) => rows.push({ type: "service", title: s.title, description: s.desc, sort_order: (i + 1) * 10, meta: { items: s.items } }));
  skillGroups.forEach((g, i) => rows.push({ type: "skill", title: g.title, description: g.skills.join(", "), sort_order: (i + 1) * 10, meta: { items: g.skills } }));
  posts.forEach((p, i) =>
    rows.push({
      type: "blog", title: p.title, description: p.excerpt, subtitle: p.category, slug: p.slug, body: p.content.join("\n\n"),
      featured: p.slug === featuredPostSlug ? 1 : 0, sort_order: (i + 1) * 10, meta: { date: p.date, read: p.read },
    }),
  );
  experience.forEach((e, i) => rows.push({ type: "experience", title: e.role, subtitle: e.company, description: e.desc, sort_order: (i + 1) * 10, meta: { period: e.period } }));
  return rows;
}

export type UpgradeReport = {
  fromVersion: number;
  toVersion: number;
  inserted: Record<string, number>;
  skippedExisting: Record<string, number>;
  legacySlugsAdded: number;
  rowCountsBefore: Record<string, number>;
  rowCountsAfter: Record<string, number>;
};

/**
 * Applies upgrade v1. Refuses to run unless `backupSha256` equals the SHA-256 of
 * a fresh export of the database as it is right now, proving the owner holds a
 * backup of the exact current state. Purely additive.
 */
export async function applyUpgradeV1(db: D1Like, actor: string, backupSha256: string): Promise<UpgradeReport> {
  await ensureLegacyTables(db);
  const fromVersion = await getSchemaVersion(db);
  if (fromVersion >= 1) throw new UpgradeError("already_applied", "Upgrade v1 has already been applied.");

  const before = await exportDatabase(db);
  if (!backupSha256 || before.sha256 !== backupSha256) {
    throw new UpgradeError(
      "backup_mismatch",
      "The backup you confirmed does not match the database's current state (new data may have arrived). Download a fresh backup and try again.",
    );
  }

  await applySchemaV1(db);

  const plan = await buildV1Writes(db, actor, "v1_content_model", backupSha256);
  // D1 runs a batch as a single transaction: either every row is written or none.
  await db.batch(plan.writes);

  const after = await exportDatabase(db);
  return {
    fromVersion,
    toVersion: 1,
    inserted: plan.inserted,
    skippedExisting: plan.skippedExisting,
    legacySlugsAdded: plan.legacySlugsAdded,
    rowCountsBefore: before.counts,
    rowCountsAfter: after.counts,
  };
}

/**
 * The writes that bring a v0 content set to v1: original portfolio content (only
 * where no published entry with the same type and title exists), slugs for old
 * blog posts, default site text, and the migration record. Nothing is executed
 * here; callers run the list in one transaction.
 */
export async function buildV1Writes(db: D1Like, actor: string, migrationName: string, backupSha256: string | null) {
  const now = new Date().toISOString();
  const inserted: Record<string, number> = {};
  const skippedExisting: Record<string, number> = {};
  const writes: D1PreparedStatementLike[] = [];
  for (const row of buildSeedRows()) {
    const existing = await db
      .prepare("SELECT id FROM content_items WHERE type = ? AND status = 'published' AND lower(trim(title)) = lower(trim(?)) LIMIT 1")
      .bind(row.type, row.title)
      .first<{ id: number }>();
    if (existing) {
      skippedExisting[row.type] = (skippedExisting[row.type] ?? 0) + 1;
      continue;
    }
    const values: SqlValue[] = [
      row.type, row.title, row.description, "published", now, row.slug ?? null, row.subtitle ?? null, row.body ?? null,
      row.url ?? null, row.url_label ?? null, row.image ?? null, row.featured ?? 0, row.sort_order, JSON.stringify(row.meta ?? {}), now,
    ];
    writes.push(
      db
        .prepare(
          "INSERT INTO content_items (type, title, description, status, created_at, slug, subtitle, body, url, url_label, image, featured, sort_order, meta, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(...values),
    );
    inserted[row.type] = (inserted[row.type] ?? 0) + 1;
  }
  const legacyPosts = await db
    .prepare("SELECT id, title FROM content_items WHERE type = 'blog' AND (slug IS NULL OR slug = '')")
    .all<{ id: number; title: string }>();
  for (const p of legacyPosts.results) {
    writes.push(db.prepare("UPDATE content_items SET slug = ? WHERE id = ? AND (slug IS NULL OR slug = '')").bind(`${slugify(p.title)}-${p.id}`, p.id));
  }
  for (const [key, value] of Object.entries(defaultSettings)) {
    writes.push(db.prepare("INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)").bind(key, value, now));
  }
  writes.push(
    db
      .prepare("INSERT INTO schema_migrations (version, name, applied_at, applied_by, backup_sha256) VALUES (1, ?, ?, ?, ?)")
      .bind(migrationName, now, actor, backupSha256),
    db
      .prepare("INSERT INTO audit_log (actor, action, entity, entity_id, detail, created_at) VALUES (?, ?, 'database', '1', ?, ?)")
      .bind(actor, migrationName === "v1_content_model" ? "upgrade" : migrationName, JSON.stringify({ inserted, skippedExisting, backupSha256 }), now),
  );
  return { writes, inserted, skippedExisting, legacySlugsAdded: legacyPosts.results.length };
}

/**
 * Fresh database (no content, no messages): fill it with the original portfolio
 * content. Refuses if anything is already there, so it can never overwrite data.
 */
export async function initializeWithOriginalContent(db: D1Like, actor: string) {
  if ((await getDbState(db)) !== "uninitialized") {
    throw new UpgradeError("already_applied", "This database already has content. Nothing was changed.");
  }
  await applySchemaV1(db);
  const plan = await buildV1Writes(db, actor, "vercel_init_original_content", null);
  await db.batch(plan.writes);
  return { inserted: plan.inserted };
}

export class UpgradeError extends Error {
  constructor(public code: "already_applied" | "backup_mismatch", message: string) {
    super(message);
  }
}
