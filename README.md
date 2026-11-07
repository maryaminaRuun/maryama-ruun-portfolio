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

## Technology

- React
- TypeScript
- Vinext / Vite
- Cloudflare Workers
- Cloudflare D1
- Drizzle ORM
- CSS

## Local development

```bash
npm install
npm run dev
```

## Tests

```bash
npm run test:logic   # database, backup, upgrade, CRUD, roles, media (no build needed)
npm test             # production build + rendered HTML test
```

## Documentation

- [Database backup & upgrade](docs/UPGRADE-AND-BACKUP.md)
- [Installation & deployment](docs/DEPLOYMENT.md)
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
