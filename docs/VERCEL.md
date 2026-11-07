# Vercel migration runbook (branch `vercel-migration`)

The live site on ChatGPT Sites and its database are **not touched** by anything here.
Production on Vercel is **not** enabled until the owner approves a tested Preview.

## Architecture

| Part | Before (ChatGPT Sites) | Now (Vercel) |
|---|---|---|
| Framework | Vinext on Cloudflare Workers | Standard Next.js 16 (App Router) |
| Database | Cloudflare D1 | Turso (libSQL, SQLite-compatible), same tables and SQL |
| Images | In D1 / R2 | Vercel Blob (falls back to the database if Blob isn't connected) |
| Admin sign-in | ChatGPT account header | Built in: password + **required** authenticator code (TOTP), recovery codes, server-side sessions |
| Roles | Owner / editor | Same. Owner `ruun4646@gmail.com`; editors join by single-use invite link |

## 1. Vercel configuration (Preview first)

In the Vercel project `maryama-ruun-portfolio` (already connected to the GitHub repo):

1. **Build settings** (Settings → Build & Development): Framework **Next.js**. Leave Build
   Command, Output Directory and Install Command **empty / default**. `vercel.json` sets them.
   Remove any overrides left from September.
2. **Database:** Storage → Create Database → **Turso** (Marketplace). Create `portfolio-preview`
   and connect it to the **Preview** environment only. This adds `TURSO_DATABASE_URL` and
   `TURSO_AUTH_TOKEN` automatically.
3. **Images:** Storage → Create → **Blob**, name `portfolio-media`, connect to the project. This adds
   `BLOB_READ_WRITE_TOKEN`.
4. **Environment variables** (Settings → Environment Variables → Preview):
   - `AUTH_SECRET`: 32+ random characters (for example a generated 48-character password).
   - `ADMIN_SETUP_KEY`: a passphrase of 16+ characters. Used once at `/admin/setup`.
5. **Redeploy** the latest `vercel-migration` Preview (Deployments → … → Redeploy), so it picks up the variables.
6. **Optional, recommended:** Settings → Deployment Protection → *Protection Bypass for
   Automation* → create a secret, and save it in GitHub (repo Settings → Secrets and variables →
   Actions) as `VERCEL_AUTOMATION_BYPASS_SECRET`. GitHub Actions then runs read-only checks against
   every Preview.

Never paste these values into chat or commit them.

## 2. First sign-in on the Preview

1. Open `<preview-url>/admin` → **Create the owner account** → enter `ADMIN_SETUP_KEY`, choose a
   password (12+ characters).
2. Scan the QR code with an authenticator app (Google/Microsoft Authenticator, 1Password, Authy…)
   and enter the 6-digit code.
3. **Save the 8 recovery codes.** They're shown once.
4. Optional: remove `ADMIN_SETUP_KEY` afterwards and redeploy. While it's set, `/admin/setup` can
   reset the owner's password and authenticator (the recovery path if all recovery codes are lost).

## 3. Data: backup → import (needs owner approval for production data)

The live data is in the ChatGPT Sites D1 database. Only that hosting can read it.

1. **Get a backup of the live site** in one of these ways:
   - Deploy `redesign/portfolio-admin-v2` to ChatGPT Sites and use **Admin → Database & backup →
     Download backup**, or
   - ask Codex to export the live D1 database in the same format.
2. Check it: `npm run backup:verify -- backup.sql`
3. In the Vercel admin: **Database & backup → Import a backup**. The admin:
   - refuses unless the database is empty (no content, no messages),
   - checks the file's SHA-256 fingerprint before writing anything,
   - parses the file and inserts only rows for known tables and columns (it never executes the file as SQL),
   - writes everything in one transaction, then reads every row back and compares it with the file,
   - for a backup of the original (v0) site, adds the original portfolio content the same way the v1 upgrade does.
4. Files over 4 MB: `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run backup:import -- backup.sql`
   (same checks).

For a quick trial without live data, use *Start with the original portfolio content* instead.

Contact messages and page views are **not recorded** on a new deployment until the database has
been set up, so imported IDs never clash.

## 4. Verification (automated)

`.github/workflows/ci.yml` runs on every push to `vercel-migration`:

- `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (38 database/import/auth/admin tests)
- `npm run build` (production build)
- `next start` with a throwaway database plus **Playwright end-to-end** (61 checks): public pages,
  owner setup with MFA, backup import with row-by-row verification, every admin create/edit/delete
  action, image upload, editor invite with MFA, roles, recovery-code sign-in, and security checks
  (CSRF, forged cookies, rate limits, no secrets in backups).
- After each successful Vercel Preview deployment: read-only smoke checks against the Preview
  (needs the bypass secret from step 1.6).

## 5. Production switch (only after the owner approves)

1. Create a separate Turso database `portfolio-production`, connected to **Production** only.
2. Add `AUTH_SECRET` (a different value from Preview) and `ADMIN_SETUP_KEY` for Production.
3. Take a **fresh** backup from the live site, verify it, import it into production, and compare row counts.
4. Merge `vercel-migration` into the production branch chosen by the owner, or promote the approved deployment.
5. Point the domain to Vercel only after checking the production URL. The ChatGPT Sites site stays
   available as a fallback, and is not deleted.

Data written to the old site after the backup (new messages) would need a second, incremental
import. Keep the time between the backup and the domain switch short, or pause the old contact form.
