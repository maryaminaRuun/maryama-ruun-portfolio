# Database backup & upgrade (v1)

The portfolio uses **Cloudflare D1** (SQLite), bound as `DB` and managed by the
current hosting (`.openai/hosting.json`). There is no Supabase in this project.

## Safety rules built into the code

| Rule | Where it is enforced |
|---|---|
| Deploying the new code changes **nothing** in the database. On every request it only runs the same `CREATE TABLE IF NOT EXISTS` statements as the September site. | `lib/db/schema.ts` → `LEGACY_TABLES` |
| The upgrade never runs automatically. Only the **owner** can start it, from the Admin Dashboard. | `app/api/admin/upgrade/route.ts` (owner-only, same-origin) |
| The owner must first download a full backup. The server recomputes the SHA-256 of the database and refuses to upgrade unless it matches the backup **exactly**. If even one new visit or message arrived since, it asks for a fresh backup. | `lib/db/upgrade.ts` → `applyUpgradeV1` |
| The owner must tick “I have saved the backup” and type `UPGRADE`. | `AdminPanel.tsx` → Database & backup |
| The upgrade is **additive only**: `ADD COLUMN` and `CREATE TABLE`. No `DROP`, no `DELETE`, no overwriting existing values. | `lib/db/schema.ts` → `UPGRADE_V1_*` |
| The content seed runs as one transaction: everything or nothing. | `db.batch(...)` in `applyUpgradeV1` |
| Original content is only added if no **published** entry with the same type and title exists, so nothing is duplicated or replaced. | `applyUpgradeV1` |

## What upgrade v1 adds

- New columns on `content_items`: `slug, subtitle, body, url, url_label, image, featured, sort_order, meta, updated_at`.
- New columns on `page_views`: `referrer, country, device`.
- New tables: `schema_migrations, site_settings, admin_users, media, audit_log, rate_limits`.
- Seeds the original portfolio content as editable entries: 10 projects (first 6 featured), 4 services, 4 skill groups, 4 blog posts and 3 experience entries. It also seeds the site text (wording from the live site).
- Gives blog posts created in the old admin a URL slug, so they get their own page.

## Procedure (production)

1. **Download the backup.** Go to Admin → Database & backup → *Download backup (.sql)*. Note the row counts and SHA-256 shown.
2. **Verify the backup** on your computer:
   ```bash
   npm run backup:verify -- ~/Downloads/maryama-portfolio-backup-….sql
   ```
   It must print `Backup verified`.
3. **Rehearse the upgrade on a copy (staging).** This never touches the live database:
   ```bash
   npm run upgrade:rehearse -- ~/Downloads/maryama-portfolio-backup-….sql staging-copy.db
   ```
   Every line must show ✓.
4. **Apply.** Back in Admin → Database & backup, tick the checkbox, type `UPGRADE` and click *Apply upgrade*. Keep the upgrade report.
5. **Check** the homepage (6 projects), Services (the admin-added service is still first) and Blog.

If step 4 says the backup does not match, someone visited or wrote in since step 1. Download a new backup and repeat.

## Restoring a backup

Restore into a **new, empty** database only:

```bash
sqlite3 restored.db < maryama-portfolio-backup-….sql          # local copy
npx wrangler d1 execute <new-db-name> --remote --file maryama-portfolio-backup-….sql   # new D1 database
```

The backup file contains contact-form messages (names and emails). Store it privately. Never commit it to the public GitHub repository.
