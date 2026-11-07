# Maryama Ruun Portfolio

A modern full-stack portfolio website for Maryama Ruun, Software Engineer and Full-Stack Developer based in Mogadishu, Somalia.

## Live website

[View the portfolio](https://maryama-ruun-portfolio.ruun4646.chatgpt.site)

## Main features

- Professional responsive homepage
- Six featured production projects
- Complete projects, about, services, blog, and contact pages
- Project screenshots and external project links
- Admin dashboard with owner/editor roles: full CRUD for projects, services, skills, blog, experience, certificates and testimonials
- Image uploads (Cloudflare R2 when bound, otherwise D1), media library
- Editable site text and links, exactly 6 featured homepage projects
- Owner-only full SQL backup and backup-verified, additive database upgrades
- Page-view and visitor analytics
- Contact-message inbox
- Light and dark theme support
- Mobile-friendly navigation and layouts

## Technology (branch `vercel-migration`)

- Next.js 16 (App Router), React 19, TypeScript
- Hosted on Vercel
- Turso (libSQL / SQLite) database
- Vercel Blob for images
- Built-in admin sign-in with required authenticator-app MFA

See [docs/VERCEL.md](docs/VERCEL.md) for configuration, data import and the production switch.

## Local development

```bash
npm ci
AUTH_SECRET=$(openssl rand -hex 24) ADMIN_SETUP_KEY=local-setup-key-123 npm run dev   # uses ./local.db
```

## Tests

```bash
npm run lint && npm run typecheck
npm test             # database, backup/import, auth/MFA, CRUD, roles, media
npm run build
npm run test:e2e     # browser tests against `next start` (see .github/workflows/ci.yml)
```

## Documentation

- [Database backup & upgrade](docs/UPGRADE-AND-BACKUP.md)
- [Vercel migration runbook](docs/VERCEL.md)
- [Installation & deployment (ChatGPT Sites version)](docs/DEPLOYMENT.md)
- [Test report](docs/TEST-REPORT.md)

## Production build

```bash
npm run build
```

## Main routes

- `/` — Homepage
- `/projects` — Complete project portfolio
- `/about` — Profile, experience, and skills
- `/services` — Development and design services
- `/blog` — Articles and product-engineering notes
- `/contact` — Contact form
- `/admin` — Private administration dashboard
- `/sitemap.xml`, `/robots.txt` — SEO

## Author

**Maryama Ruun**

- GitHub: [maryaminaRuun](https://github.com/maryaminaRuun)
- Email: maryamiinaruun6@gmail.com
