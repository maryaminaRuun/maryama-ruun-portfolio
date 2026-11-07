> **Note:** this describes the ChatGPT Sites / Cloudflare version (branch `redesign/portfolio-admin-v2`). For the Vercel version on this branch, see [VERCEL.md](VERCEL.md).

# Installation & deployment guide

## Stack (unchanged)

Vinext (Next.js App Router on Vite) · React 19 · TypeScript · Cloudflare Workers ·
Cloudflare D1 (`DB`) · optional Cloudflare R2 for images · Drizzle config.
Hosting today: **ChatGPT Sites** (`.openai/hosting.json`, project `appgprj_6a6dbe96…`).

## Local development

Requires Node.js ≥ 22.13.

```bash
npm ci                 # or: npm run install:ci
npm run dev            # http://localhost:5173 with a local D1 (Miniflare)
npm run test:logic     # database, upgrade, backup, CRUD, roles and media tests (no build needed)
npm run build          # bounded vinext build + artifact validation
npm test               # build + rendered-HTML test
npm run lint
```

`localhost` is a trusted host for the platform sign-in header. To open `/admin`
locally, send the header with a browser extension, or test the API with
`curl -H "oai-authenticated-user-email: ruun4646@gmail.com"`.

## Environment & secrets

No secrets are needed in the code or the repository.

| Name | Where | Purpose |
|---|---|---|
| `DB` (D1 binding) | Provided by hosting (`hosting.json` → `"d1": "DB"`) | Database |
| R2 binding (optional) | Set `"r2": "MEDIA"` in `.openai/hosting.json` **only if** the hosting provisions R2 | Image storage. Without it, images are stored in D1 (max 1.9 MB each, resized in the browser before upload). |
| `ADMIN_TRUSTED_HOSTS` (optional) | Hosting environment variables | Comma-separated extra hostnames (e.g. a custom domain served by ChatGPT Sites) where the platform sign-in header is trusted. |

## Admin access, roles and MFA

- **Identity** comes from ChatGPT Sites sign-in (`/signin-with-chatgpt`). Turn on
  **multi-factor authentication in the ChatGPT account security settings**. That is
  the account's MFA, and the platform manages sign-in sessions and sign-out.
- **Owner:** `ruun4646@gmail.com` (fixed in `lib/owner.ts`). Full access.
- **Editors:** invited by the owner in *Team & access*, after the upgrade. They can create and edit
  content and upload images. They cannot delete, read messages, change site text, manage the team,
  back up or upgrade.
- Admin writes are rejected unless they come from the same site (CSRF protection).
  The sign-in header is ignored on untrusted hosts (see `isPlatformAuthTrusted`).

## Deploying to the existing ChatGPT Sites hosting (recommended)

This keeps the same D1 database, URL and sign-in.

1. Merge nothing yet. Review the branch `redesign/portfolio-admin-v2`.
2. In the Codex project that publishes `maryama-ruun-portfolio.ruun4646.chatgpt.site`,
   check out the branch and run `npm ci && npm run test:logic && npm run build && npm test`.
3. Use the Codex **preview** (development) to click through the site and `/admin` as staging.
   The preview uses the preview database. If it shares the production database, do **not**
   apply the upgrade there yet.
4. Publish. **Nothing in the database changes on deploy.**
5. Follow `docs/UPGRADE-AND-BACKUP.md`: back up → verify → rehearse → apply.

## Deploying a separate Cloudflare staging copy (own account)

Possible, but note the following:
- The admin will be **locked** there (the sign-in header is not trusted on `*.workers.dev`).
  That is intentional, because anyone could forge it on a host ChatGPT doesn't control. For a fully
  working admin outside ChatGPT Sites, add Cloudflare Access (Zero Trust, supports MFA) in
  front of `/admin*` and `/api/admin*`, and switch `getChatGPTUser` to verify the
  `Cf-Access-Jwt-Assertion` token. That is a separate, approved change.
- Use a **new** D1 database restored from a backup (`wrangler d1 create portfolio-staging`,
  then `wrangler d1 execute portfolio-staging --remote --file backup.sql`). Never point staging at
  the production database.
- Store the Cloudflare API token in GitHub Actions secrets or your local `wrangler login`.
  Never put it in the repository or in chat.

## Production DNS

Not changed by anything in this branch. Switching domains or hosting needs the owner's
explicit approval.
