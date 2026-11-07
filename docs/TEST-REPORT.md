# Test report — branch `redesign/portfolio-admin-v2`

Date: 7 November 2026. Base: September 2026 source (`Maryama` @ `c992e21`), identical
to both Codex ZIP exports and the GitHub download.

## Environment limitation (blocking)

The npm registry was **blocked** in the environment where this work was done, so
`npm ci`, `vinext build`, `npm test` (rendered-HTML test) and `npm run lint` **have not
run yet**. The work is **not complete** until those pass. Everything below ran
without installing packages.

## What was tested

### 1. Logic tests: `npm run test:logic` → 23/23 pass
Run against real SQLite with the same SQL the app sends to D1.

- Backup exports every table and row. Restoring it gives a byte-identical database (SHA-256 match).
- Backup is read-only and its hash is stable.
- Upgrade refuses a wrong or stale backup and **changes nothing**.
- Upgrade keeps every original `content_items`, `contact_messages` and `page_views` row exactly.
- Draft duplicates from the old admin don't hide original content. Published duplicates aren't seeded twice.
- Schema upgrade is idempotent.
- Legacy mode reproduces the live site (admin-added service first, 6 homepage projects, featured post, GitHub URL).
- Public content is the same before and after the upgrade.
- CRUD for every content type, unique blog slugs, max 6 featured, reorder, input validation (blocks `javascript:` URLs and images).
- Settings validation, owner/editor roles, editors cannot see messages.
- Analytics before and after upgrade, media signature sniffing, size limit, in-use protection, R2 path.
- Same-origin (CSRF) check.

### 2. Browser end-to-end (Chromium): 40/40 pass
A local harness ran the **real route handlers and pages**, with only the framework glue
replaced. It used a live-like database: the admin-added "web develpment" service, 2 messages and 242 page views.

- The overview shows the upgrade banner before the upgrade.
- Backup downloads with all tables. The Apply button stays disabled until the box is ticked and `UPGRADE` is typed. The upgrade succeeds and row counts never shrink.
- Projects: 10 listed, 6/6 featured, featuring a 7th is refused. Creating a project with an image upload works, and the image is served at `/media/…`. Edit, feature/unfeature, reorder and draft (hidden publicly) work. Delete goes through a confirm dialog.
- Blog: a new post gets its own page. The legacy service could be renamed ("Web Development") and given bullet points.
- Site text: LinkedIn saved and shown on the homepage. An invalid email is rejected.
- Messages can be marked as read. An editor can be invited. The media library works.
- No console errors.
- Security: editors can't delete or download backups (403). Strangers and signed-out users get 403. Cross-site writes get 403. A fake image is rejected. A forged sign-in header on an untrusted host is ignored. The owner is accepted on `*.chatgpt.site`.
- Contact form: rate limit after 5 messages per hour per IP. The honeypot works.

### 3. Public pages
Every route returns 200 (unknown pages and posts return 404), including `sitemap.xml` and `robots.txt`.
Screenshots were taken at 1440 px and 390 px, in light and dark themes. There are no page errors, no horizontal overflow and no broken images.

### 4. Typecheck
`tsc --strict` with temporary type stubs (real `next` and `@types/react` couldn't be installed) is clean.

### 5. Backup tools
`backup:verify` and `upgrade:rehearse` were run on a backup downloaded from the admin. Both passed.

## Still to run (requires npm access)

- [ ] `npm ci`
- [ ] `npm run build` (vinext)
- [ ] `npm test`, `npm run lint`
- [ ] Click-through on the Codex preview (staging)

## Missing or unrecoverable data

The code and database running on the live site were **not available** (all exports
were the September version). As a result:

- **Live database contents are unknown.** The only database row confirmed from the live pages is the
  service “web develpment / real solution”. Contact messages, page views and any other admin
  entries exist **only in the live D1 database**. They are **not lost**: the new code keeps reading
  the same database and never deletes from it, and they will show up once this branch is deployed
  to the same hosting. They weren't recovered or copied anywhere by this work.
- **Live code changes made after September** were rebuilt from the public pages: the GitHub URL,
  TaskFlow link, intro, CTA and About wording, the featured blog post, and services loaded from the database.
  Admin-only behaviour of the newer live version that isn't visible publicly couldn't be recovered.
- **LinkedIn:** the live site links to the generic `linkedin.com` homepage. That link is now hidden until a
  real profile URL is entered in *Site text & links*.
