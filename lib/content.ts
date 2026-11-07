import {
  defaultSettings,
  experience as staticExperience,
  featuredPostSlug,
  HOMEPAGE_PROJECT_COUNT,
  posts as staticPosts,
  projects as staticProjects,
  services as staticServices,
  skillGroups as staticSkills,
  type SiteSettings,
} from "../app/site-data";
import { ensureLegacyTables, getSchemaVersion } from "./db/schema";
import { getEnvDb, type D1Like } from "./db/types";

export type Project = { id?: number; title: string; tag: string; desc: string; url: string; label: string; image: string; tone: string; mark: string; featured: boolean };
export type Service = { title: string; desc: string; number: string; items: string[] };
export type SkillGroup = { title: string; icon: string; skills: string[] };
export type Post = { slug: string; category: string; date: string; read: string; title: string; excerpt: string; content: string[]; featured: boolean; image?: string };
export type Experience = { period: string; role: string; company: string; desc: string };
export type Highlight = { title: string; subtitle: string; desc: string; url: string };

export type SiteContent = {
  /** database: upgraded schema; legacy: old schema, static + legacy rows; static: no database. */
  mode: "database" | "legacy" | "static";
  settings: SiteSettings;
  projects: Project[];
  services: Service[];
  skills: SkillGroup[];
  posts: Post[];
  experience: Experience[];
  certificates: Highlight[];
  testimonials: Highlight[];
};

export type ContentRow = {
  id: number;
  type: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  slug?: string | null;
  subtitle?: string | null;
  body?: string | null;
  url?: string | null;
  url_label?: string | null;
  image?: string | null;
  featured?: number | null;
  sort_order?: number | null;
  meta?: string | null;
  updated_at?: string | null;
};

const TONES = ["indigo", "blue", "emerald", "amber", "rose", "violet"];
const pad = (n: number) => String(n).padStart(2, "0");

export function parseMeta(meta: string | null | undefined): Record<string, unknown> {
  if (!meta) return {};
  try {
    const v = JSON.parse(meta);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const splitList = (text: string) => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

function initials(title: string) {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "P";
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function rowToProject(r: ContentRow, i: number): Project {
  const m = parseMeta(r.meta);
  const url = r.url || "/contact";
  return {
    id: r.id, title: r.title, tag: r.subtitle || "Project", desc: r.description, url,
    label: r.url_label || (url === "/contact" ? "Ask about this project" : "View project"),
    image: r.image || "", tone: str(m.tone, TONES[i % TONES.length]), mark: str(m.mark, initials(r.title)), featured: !!r.featured,
  };
}

export function rowToPost(r: ContentRow): Post {
  const m = parseMeta(r.meta);
  const body = (r.body || r.description || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const words = body.join(" ").split(/\s+/).length;
  return {
    slug: r.slug || `post-${r.id}`, category: r.subtitle || "Article", date: str(m.date, formatDate(r.created_at)),
    read: str(m.read, `${Math.max(1, Math.round(words / 200))} min read`), title: r.title, excerpt: r.description,
    content: body, featured: !!r.featured, image: r.image || undefined,
  };
}

const bySort = (a: ContentRow, b: ContentRow) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;

/** Assemble public content from rows. Exported for tests. */
export function assembleContent(mode: SiteContent["mode"], rows: ContentRow[], settingRows: { key: string; value: string }[]): SiteContent {
  const settings: SiteSettings = { ...defaultSettings };
  for (const s of settingRows) if (s.key in settings) (settings as Record<string, string>)[s.key] = s.value;
  const published = rows.filter((r) => r.status === "published").sort(bySort);
  const of = (type: string) => published.filter((r) => r.type === type);
  const highlights = (type: string): Highlight[] => of(type).map((r) => ({ title: r.title, subtitle: r.subtitle || "", desc: r.description, url: r.url || "" }));

  if (mode === "database") {
    return {
      mode, settings,
      projects: of("project").map(rowToProject),
      services: of("service").map((r, i) => ({ title: r.title, desc: r.description, number: pad(i + 1), items: list(parseMeta(r.meta).items) })),
      skills: of("skill").map((r, i) => {
        const items = list(parseMeta(r.meta).items);
        return { title: r.title, icon: pad(i + 1), skills: items.length ? items : splitList(r.description) };
      }),
      posts: of("blog").map(rowToPost),
      experience: of("experience").map((r) => ({ period: str(parseMeta(r.meta).period), role: r.title, company: r.subtitle || "", desc: r.description })),
      certificates: highlights("certificate"),
      testimonials: highlights("testimonial"),
    };
  }

  // Legacy / static: original content, plus anything added through the old admin.
  // The live site lists admin-added services before the built-in ones.
  const legacyServices = of("service").map((r) => ({ title: r.title, desc: r.description, items: [] as string[] }));
  const allServices = [...legacyServices, ...staticServices.map((s) => ({ title: s.title, desc: s.desc, items: s.items }))];
  const legacyProjects = of("project").map((r, i) => rowToProject(r, staticProjects.length + i));
  return {
    mode, settings,
    projects: [...staticProjects.map((p, i) => ({ ...p, featured: i < HOMEPAGE_PROJECT_COUNT })), ...legacyProjects],
    services: allServices.map((s, i) => ({ ...s, number: pad(i + 1) })),
    skills: staticSkills.map((g) => ({ title: g.title, icon: g.icon, skills: g.skills })),
    posts: staticPosts.map((p) => ({ ...p, featured: p.slug === featuredPostSlug })),
    experience: staticExperience,
    certificates: highlights("certificate"),
    testimonials: highlights("testimonial"),
  };
}

/** Exactly HOMEPAGE_PROJECT_COUNT projects: featured first (in order), then the rest. */
export function selectHomepageProjects(projects: Project[]): Project[] {
  const featured = projects.filter((p) => p.featured);
  const rest = projects.filter((p) => !p.featured);
  return [...featured, ...rest].slice(0, HOMEPAGE_PROJECT_COUNT);
}

export async function loadContentFrom(db: D1Like): Promise<SiteContent> {
  await ensureLegacyTables(db);
  const version = await getSchemaVersion(db);
  const rows = await db.prepare("SELECT * FROM content_items").all<ContentRow>();
  if (version >= 1) {
    const settings = await db.prepare("SELECT key, value FROM site_settings").all<{ key: string; value: string }>();
    return assembleContent("database", rows.results, settings.results);
  }
  return assembleContent("legacy", rows.results, []);
}

/** Public pages call this. Never throws: falls back to the original static content. */
export async function getSiteContent(): Promise<SiteContent> {
  try {
    return await loadContentFrom(await getEnvDb());
  } catch {
    return assembleContent("static", [], []);
  }
}
