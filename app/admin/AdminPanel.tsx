"use client";
import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------- Types ----------
type Role = "owner" | "editor";
type Item = {
  id: number; type: string; title: string; description: string; status: string; created_at: string;
  slug?: string | null; subtitle?: string | null; body?: string | null; url?: string | null; url_label?: string | null;
  image?: string | null; featured?: number | null; sort_order?: number | null; meta?: string | null; updated_at?: string | null;
};
type Message = { id: number; name: string; email: string; subject: string; message: string; status: string; created_at: string };
type Bar = { label?: string; path?: string; views: number };
type Analytics = {
  range: number;
  summary: { total: number; visitors: number; today: number; inRange: number } | null;
  daily: { day: string; views: number; visitors: number }[];
  pages: Bar[]; referrers: Bar[]; countries: Bar[]; devices: Bar[];
};
type Media = { id: string; filename: string; content_type: string; size: number; alt: string; created_at: string; created_by: string };
type User = { email: string; role: string; created_at: string; created_by: string };
type AuditRow = { actor: string; action: string; entity: string; entity_id: string | null; created_at: string };
type Data = {
  me: { email: string; name: string; role: Role };
  schemaVersion: number;
  items: Item[]; messages: Message[]; analytics: Analytics; settings: Record<string, string>;
  media: Media[]; users: User[]; audit: AuditRow[];
};
type Toast = { id: number; kind: "ok" | "error"; text: string };

// ---------- Configuration ----------
const TYPES: { key: string; type: string; label: string; singular: string; icon: string; hint: string }[] = [
  { key: "projects", type: "project", label: "Projects", singular: "project", icon: "▦", hint: "Homepage shows exactly 6 featured projects (★)." },
  { key: "services", type: "service", label: "Services", singular: "service", icon: "◈", hint: "Shown on Home (first 4) and the Services page." },
  { key: "skills", type: "skill", label: "Skills", singular: "skill group", icon: "◆", hint: "Skill groups on the About page." },
  { key: "blogs", type: "blog", label: "Blog posts", singular: "post", icon: "✎", hint: "Featured post is highlighted on the Blog page." },
  { key: "experience", type: "experience", label: "Experience", singular: "role", icon: "◷", hint: "Timeline on the About page." },
  { key: "certificates", type: "certificate", label: "Certificates", singular: "certificate", icon: "✓", hint: "Shown on About when published." },
  { key: "testimonials", type: "testimonial", label: "Testimonials", singular: "testimonial", icon: "❝", hint: "Shown on About when published." },
  { key: "other", type: "other", label: "Other entries", singular: "entry", icon: "◇", hint: "Profile/setting entries created in the old admin (kept for safety)." },
];
const LEGACY_OTHER = ["profile", "setting"];
const TONES = ["indigo", "blue", "emerald", "amber", "rose", "violet"];
const SETTINGS_GROUPS: { title: string; fields: { key: string; label: string; long?: boolean; hint?: string }[] }[] = [
  {
    title: "Home page",
    fields: [
      { key: "hero_eyebrow", label: "Availability line" },
      { key: "hero_name", label: "Name" },
      { key: "hero_role", label: "Role / headline" },
      { key: "hero_lead", label: "Intro sentence", long: true },
      { key: "featured_intro", label: "Featured projects intro", long: true },
      { key: "years_experience", label: "Years of experience (metric)" },
      { key: "products_delivered", label: "Products delivered (metric)" },
    ],
  },
  {
    title: "About page",
    fields: [
      { key: "about_hero_text", label: "About page subtitle", long: true },
      { key: "bio", label: "Bio (blank line between paragraphs; also used on Home)", long: true },
      { key: "location", label: "Location" },
      { key: "education", label: "Education" },
      { key: "focus", label: "Focus" },
      { key: "languages", label: "Languages" },
    ],
  },
  {
    title: "Contact & links",
    fields: [
      { key: "email", label: "Contact email" },
      { key: "timezone", label: "Time zone" },
      { key: "contact_intro", label: "Contact intro", long: true },
      { key: "github_url", label: "GitHub URL" },
      { key: "linkedin_url", label: "LinkedIn URL", hint: "Leave empty to hide the LinkedIn link." },
      { key: "site_url", label: "Public site URL (for SEO)" },
    ],
  },
];

// ---------- Helpers ----------
function parseMeta(m?: string | null): Record<string, unknown> {
  try {
    const v = JSON.parse(m || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
};
const fmtBytes = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

async function api<T = { ok: boolean }>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers } });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

/** Shrink large images in the browser before upload (keeps D1 storage small and pages fast). */
async function prepareImage(file: File): Promise<Blob> {
  if (file.type === "image/gif" || (file.size < 900_000 && file.type !== "image/png")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / bmp.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", 0.86));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

// ---------- Small components ----------
function TrendChart({ data }: { data: Analytics["daily"] }) {
  const W = 560, H = 170;
  const max = Math.max(1, ...data.map((d) => Number(d.views)));
  const x = (i: number) => (i * W) / Math.max(1, data.length - 1);
  const y = (v: number) => 150 - (Number(v) / max) * 120;
  const pts = data.map((d, i) => `${x(i)},${y(d.views)}`).join(" ");
  const step = Math.ceil(data.length / 7);
  const total = data.reduce((a, d) => a + Number(d.views), 0);
  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Page views over the last ${data.length} days: ${total} total`}>
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6c63ff" stopOpacity=".3" />
            <stop offset="1" stopColor="#6c63ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[30, 70, 110, 150].map((g) => (
          <line key={g} x1="0" y1={g} x2={W} y2={g} className="chart-grid" />
        ))}
        {data.length > 1 && (
          <>
            <polygon points={`0,150 ${pts} ${W},150`} fill="url(#area)" />
            <polyline points={pts} fill="none" className="chart-line" />
            {data.map((d, i) => (
              <circle key={d.day} cx={x(i)} cy={y(d.views)} r={data.length > 14 ? 2.5 : 4} className="chart-dot">
                <title>{`${d.day}: ${d.views} views, ${d.visitors} visitors`}</title>
              </circle>
            ))}
          </>
        )}
      </svg>
      <div className="chart-labels">
        {data.map((d, i) =>
          i % step === 0 ? <span key={d.day}>{new Date(d.day + "T00:00:00").toLocaleDateString("en", data.length > 7 ? { day: "numeric", month: "short" } : { weekday: "short" })}</span> : null,
        )}
      </div>
    </div>
  );
}

function Bars({ rows, empty }: { rows: Bar[]; empty: string }) {
  if (!rows.length) return <Empty text={empty} />;
  const max = Math.max(1, ...rows.map((r) => Number(r.views)));
  return (
    <div className="top-pages">
      {rows.map((r, i) => {
        const label = r.path !== undefined ? (r.path === "/" ? "Home" : r.path) : r.label || "—";
        return (
          <div key={label + i}>
            <b>{i + 1}</b>
            <span title={label}>{label}</span>
            <div>
              <i style={{ width: `${Math.max(6, (Number(r.views) / max) * 100)}%` }} />
            </div>
            <strong>{r.views}</strong>
          </div>
        );
      })}
    </div>
  );
}

function Donut({ items }: { items: Item[] }) {
  const groups = [
    { name: "Projects", type: "project", color: "#6c63ff" },
    { name: "Services", type: "service", color: "#f59e0b" },
    { name: "Skills", type: "skill", color: "#20b777" },
    { name: "Blog", type: "blog", color: "#38a1db" },
  ];
  const counts = groups.map((g) => items.filter((i) => i.type === g.type).length);
  const total = Math.max(1, counts.reduce((a, b) => a + b, 0));
  let cursor = 0;
  const stops = counts.map((c, i) => {
    const start = cursor;
    cursor += (c / total) * 100;
    return `${groups[i]!.color} ${start}% ${cursor}%`;
  });
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${stops.join(",") || "#e7e5f0 0 100%"})` }} role="img" aria-label="Content mix">
        <div>
          <b>{items.length}</b>
          <span>Total</span>
        </div>
      </div>
      <ul>
        {groups.map((g, i) => (
          <li key={g.name}>
            <i style={{ background: g.color }} />
            <span>{g.name}</span>
            <b>{counts[i]}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="admin-empty">
      <span aria-hidden="true">◇</span>
      <h3>Nothing here yet</h3>
      <p>{text}</p>
    </div>
  );
}

function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="admin-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`admin-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

// ---------- Item editor ----------
function ItemEditor({
  type, item, upgraded, onCancel, onSaved, notify,
}: {
  type: string; item: Item | null; upgraded: boolean; onCancel: () => void; onSaved: () => void; notify: (k: Toast["kind"], t: string) => void;
}) {
  const meta = parseMeta(item?.meta);
  const [image, setImage] = useState(item?.image || "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const isOther = LEGACY_OTHER.includes(type) || type === "other";
  const cfg = TYPES.find((t) => t.type === type);
  const full = upgraded && !isOther;
  const has = (...types: string[]) => full && types.includes(type);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const blob = await prepareImage(file);
      const fd = new FormData();
      fd.append("file", blob, file.name.replace(/\.\w+$/, blob.type === "image/webp" ? ".webp" : "$&"));
      const r = await api<{ url: string }>("/api/admin/media", { method: "POST", body: fd });
      setImage(r.url);
      notify("ok", "Image uploaded.");
    } catch (err) {
      notify("error", (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    const payload: Record<string, unknown> = {
      type: item?.type ?? type, title: get("title"), description: get("description"), status: get("status") || "published",
    };
    if (full) {
      Object.assign(payload, {
        subtitle: get("subtitle"), url: get("url"), url_label: get("url_label"), image, slug: get("slug"), body: get("body"),
        featured: f.get("featured") === "on", sort_order: Number(get("sort_order") || item?.sort_order || 0),
        meta: { items: get("items"), tone: get("tone"), mark: get("mark"), date: get("date"), read: get("read"), period: get("period") },
      });
    }
    setSaving(true);
    try {
      await api("/api/admin/content", { method: item ? "PUT" : "POST", body: JSON.stringify(item ? { ...payload, id: item.id } : payload) });
      notify("ok", item ? "Changes saved." : `${cfg?.singular ?? "Item"} created.`);
      onSaved();
    } catch (err) {
      notify("error", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const labels: Record<string, { title: string; subtitle?: string; description: string }> = {
    project: { title: "Project name", subtitle: "Category tag", description: "Short description" },
    service: { title: "Service name", description: "Description" },
    skill: { title: "Group name (e.g. Frontend)", description: "Notes (optional)" },
    blog: { title: "Post title", subtitle: "Category", description: "Excerpt (shown on cards)" },
    experience: { title: "Role", subtitle: "Company / organisation", description: "What you did" },
    certificate: { title: "Certificate", subtitle: "Issuer & year", description: "Details" },
    testimonial: { title: "Person's name", subtitle: "Role / company", description: "Quote" },
  };
  const L = labels[type] ?? { title: "Title", description: "Description" };

  return (
    <form className="admin-editor" onSubmit={submit}>
      {!upgraded && !isOther ? <p className="editor-note">Only title, description and status can be edited until the database upgrade is applied.</p> : null}
      <div className="field-grid">
        <label className="span-2">
          {L.title}
          <input name="title" defaultValue={item?.title} required maxLength={200} />
        </label>
        {has("project", "blog", "experience", "certificate", "testimonial") && L.subtitle ? (
          <label>
            {L.subtitle}
            <input name="subtitle" defaultValue={item?.subtitle ?? ""} maxLength={120} />
          </label>
        ) : null}
        {has("experience") ? (
          <label>
            Period (e.g. 2025 — 2026)
            <input name="period" defaultValue={String(meta.period ?? "")} maxLength={60} />
          </label>
        ) : null}
        {has("blog") ? (
          <>
            <label>
              URL slug
              <input name="slug" defaultValue={item?.slug ?? ""} placeholder="auto from title" pattern="[a-z0-9-]*" maxLength={80} />
            </label>
            <label>
              Date shown
              <input name="date" defaultValue={String(meta.date ?? "")} placeholder="e.g. November 7, 2026" maxLength={40} />
            </label>
            <label>
              Read time
              <input name="read" defaultValue={String(meta.read ?? "")} placeholder="auto" maxLength={30} />
            </label>
          </>
        ) : null}
        <label className="span-2">
          {L.description}
          <textarea name="description" defaultValue={item?.description} rows={type === "testimonial" ? 4 : 3} maxLength={2000} />
        </label>
        {has("blog") ? (
          <label className="span-2">
            Article body (blank line between paragraphs)
            <textarea name="body" defaultValue={item?.body ?? ""} rows={12} maxLength={60000} />
          </label>
        ) : null}
        {has("service", "skill") ? (
          <label className="span-2">
            {type === "skill" ? "Skills" : "Bullet points"} (comma or one per line)
            <textarea name="items" defaultValue={(Array.isArray(meta.items) ? (meta.items as string[]) : []).join(", ")} rows={2} />
          </label>
        ) : null}
        {has("project", "certificate") ? (
          <>
            <label>
              Link URL
              <input name="url" defaultValue={item?.url ?? ""} placeholder="https://… or /contact" maxLength={500} />
            </label>
            {type === "project" ? (
              <label>
                Link text
                <input name="url_label" defaultValue={item?.url_label ?? ""} placeholder="e.g. somxchange.com" maxLength={80} />
              </label>
            ) : null}
          </>
        ) : null}
        {has("project", "blog") ? (
          <div className="span-2 image-field">
            <span>Image {type === "project" ? "(homepage screenshot)" : "(cover, optional)"}</span>
            <div>
              {image ? <img src={image} alt="" /> : <div className="image-placeholder">No image</div>}
              <div className="image-actions">
                <label className="upload-button">
                  {uploading ? "Uploading…" : image ? "Replace image" : "Upload image"}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={upload} disabled={uploading} hidden />
                </label>
                {image ? (
                  <button type="button" className="link-button" onClick={() => setImage("")}>
                    Remove
                  </button>
                ) : null}
                <input aria-label="Image path or https URL" value={image} onChange={(e) => setImage(e.target.value)} placeholder="/projects/… or https://…" />
              </div>
            </div>
          </div>
        ) : null}
        {has("project") ? (
          <>
            <label>
              Fallback colour
              <select name="tone" defaultValue={String(meta.tone ?? "violet")}>
                {TONES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Fallback initials
              <input name="mark" defaultValue={String(meta.mark ?? "")} maxLength={4} />
            </label>
          </>
        ) : null}
        <label>
          Status
          <select name="status" defaultValue={item?.status ?? "published"}>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </label>
        {has("project", "blog") ? (
          <label className="check">
            <input type="checkbox" name="featured" defaultChecked={!!item?.featured} />
            {type === "project" ? "Featured on homepage (max 6)" : "Featured post"}
          </label>
        ) : null}
      </div>
      <footer>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving || uploading}>
          {saving ? "Saving…" : item ? "Save changes" : `Create ${cfg?.singular ?? "item"}`}
        </button>
      </footer>
    </form>
  );
}

// ---------- Main panel ----------
export default function AdminPanel({ name, role, signOut }: { name: string; role: Role; signOut: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState("overview");
  const [menu, setMenu] = useState(false);
  const [days, setDays] = useState(30);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<{ type: string; item: Item | null } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; action: () => Promise<void> } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const isOwner = role === "owner";

  const notify = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>(`/api/admin/content?days=${days}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [days]);
  useEffect(() => {
    load();
  }, [load]);

  function navigate(next: string) {
    setActive(next);
    setMenu(false);
    setQuery("");
    setStatusFilter("all");
  }

  async function run(action: () => Promise<unknown>, ok: string) {
    try {
      await action();
      notify("ok", ok);
      await load();
    } catch (e) {
      notify("error", (e as Error).message);
    }
  }
  const patch = (body: Record<string, unknown>, ok: string) => run(() => api("/api/admin/content", { method: "PATCH", body: JSON.stringify(body) }), ok);
  const askDelete = (title: string, url: string, ok: string) =>
    setConfirm({ title: "Delete permanently?", text: `“${title}” will be removed. This cannot be undone.`, action: () => run(() => api(url, { method: "DELETE" }), ok) });

  const upgraded = (data?.schemaVersion ?? 0) >= 1;
  const unread = data?.messages.filter((m) => m.status === "unread").length ?? 0;
  const cfg = TYPES.find((t) => t.key === active);
  const countOf = (type: string) => data?.items.filter((i) => (type === "other" ? LEGACY_OTHER.includes(i.type) : i.type === type)).length ?? 0;

  const shown = useMemo(() => {
    if (!data || !cfg) return [];
    const q = query.trim().toLowerCase();
    return data.items
      .filter((i) => (cfg.type === "other" ? LEGACY_OTHER.includes(i.type) : i.type === cfg.type))
      .filter((i) => statusFilter === "all" || i.status === statusFilter || (statusFilter === "featured" && i.featured))
      .filter((i) => !q || `${i.title} ${i.description} ${i.subtitle ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (upgraded ? (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id : b.id - a.id));
  }, [data, cfg, query, statusFilter, upgraded]);

  function move(item: Item, dir: -1 | 1) {
    if (!data || !cfg) return;
    const list = data.items.filter((i) => i.type === cfg.type).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
    const idx = list.findIndex((i) => i.id === item.id);
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j]!, list[idx]!];
    patch({ action: "reorder", ids: list.map((i) => i.id) }, "Order updated.");
  }

  const nav = [
    { key: "overview", label: "Overview", icon: "⌂", group: "WORKSPACE" },
    ...TYPES.filter((t) => t.key !== "other" || countOf("other") > 0).map((t) => ({ key: t.key, label: t.label, icon: t.icon, group: "CONTENT", count: countOf(t.type) })),
    { key: "media", label: "Media library", icon: "▣", group: "CONTENT", count: data?.media.length },
    ...(isOwner
      ? [
          { key: "site", label: "Site text & links", icon: "✦", group: "SETTINGS" },
          { key: "messages", label: "Messages", icon: "✉", group: "COMMUNICATION", alert: unread },
          { key: "team", label: "Team & access", icon: "◎", group: "SETTINGS" },
          { key: "database", label: "Database & backup", icon: "⛁", group: "SETTINGS", alert: upgraded ? 0 : 1 },
        ]
      : []),
  ] as { key: string; label: string; icon: string; group: string; count?: number; alert?: number }[];
  const groups = Array.from(new Set(nav.map((n) => n.group)));
  const title = nav.find((n) => n.key === active)?.label ?? "Dashboard";

  return (
    <main className="admin-shell pro-admin">
      <aside className={menu ? "open" : ""} aria-label="Admin navigation">
        <div className="admin-brand-row">
          <a className="brand admin-brand" href="/">
            <span>MR</span>
            <div>
              Maryama Ruun<small>Portfolio Admin</small>
            </div>
          </a>
          <button className="admin-close" onClick={() => setMenu(false)} aria-label="Close navigation">
            ×
          </button>
        </div>
        <nav>
          {groups.map((g) => (
            <div key={g}>
              <p>{g}</p>
              {nav
                .filter((n) => n.group === g)
                .map((n) => (
                  <button key={n.key} className={active === n.key ? "active" : ""} aria-current={active === n.key ? "page" : undefined} onClick={() => navigate(n.key)}>
                    <span aria-hidden="true">{n.icon}</span>
                    {n.label}
                    {n.alert ? <i className="alert-count">{n.key === "database" ? "!" : n.alert}</i> : n.count !== undefined ? <i>{n.count}</i> : null}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="admin-owner">
          <div aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
          <span>
            <b>{name}</b>
            <small>{isOwner ? "Owner" : "Editor"}</small>
          </span>
          <a href={signOut} title="Sign out" aria-label="Sign out">
            ↗
          </a>
        </div>
      </aside>
      {menu && <button className="admin-overlay" onClick={() => setMenu(false)} aria-label="Close navigation" />}

      <section className="admin-main">
        <header className="admin-topbar">
          <button className="admin-menu" onClick={() => setMenu(true)} aria-label="Open navigation">
            ☰
          </button>
          <div>
            <p>{isOwner ? "OWNER DASHBOARD" : "EDITOR DASHBOARD"}</p>
            <h1>{title}</h1>
          </div>
          <div className="admin-top-actions">
            <button onClick={() => load().then(() => notify("ok", "Dashboard refreshed."))}>
              ↻ <span>Refresh</span>
            </button>
            <a href="/" target="_blank" rel="noopener noreferrer">
              View website ↗
            </a>
          </div>
        </header>

        {data && !upgraded ? (
          <div className="admin-banner" role="status">
            <b>Database upgrade available.</b>{" "}
            {isOwner ? (
              <>
                Download a backup, then apply the upgrade to unlock images, featured projects, ordering, editable site text and editors.{" "}
                <button className="link-button" onClick={() => navigate("database")}>
                  Open Database &amp; backup →
                </button>
              </>
            ) : (
              "Ask the owner to apply it. Until then you can edit titles, descriptions and status."
            )}
          </div>
        ) : null}

        {error ? (
          <div className="admin-error" role="alert">
            <b>Could not load the dashboard.</b> {error}{" "}
            <button className="link-button" onClick={load}>
              Try again
            </button>
          </div>
        ) : !data ? (
          <div className="admin-loading">
            <i />
            <p>Loading dashboard data…</p>
          </div>
        ) : active === "overview" ? (
          <Overview data={data} days={days} setDays={setDays} onNav={navigate} isOwner={isOwner} unread={unread} />
        ) : cfg ? (
          <div className="admin-content-view">
            <div className="content-toolbar">
              <div>
                <h2>Manage {cfg.label.toLowerCase()}</h2>
                <p>{cfg.hint}</p>
              </div>
              {cfg.type !== "other" ? (
                <button className="primary-action" onClick={() => setEditing({ type: cfg.type, item: null })}>
                  + New {cfg.singular}
                </button>
              ) : null}
            </div>
            <div className="list-filters">
              <input type="search" placeholder={`Search ${cfg.label.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
                <option value="all">All ({countOf(cfg.type)})</option>
                <option value="published">Published</option>
                <option value="draft">Drafts</option>
                {cfg.type === "project" || cfg.type === "blog" ? <option value="featured">Featured</option> : null}
              </select>
              {cfg.type === "project" && upgraded ? (
                <span className="featured-meter">
                  ★ {data.items.filter((i) => i.type === "project" && i.featured && i.status === "published").length}/6 featured
                </span>
              ) : null}
            </div>
            <div className="admin-list pro-list">
              {shown.length ? (
                shown.map((i, idx) => (
                  <article key={i.id} className={i.status === "draft" ? "is-draft" : ""}>
                    {i.image ? <img className="item-thumb" src={i.image} alt="" /> : <div className="item-icon">{i.title.slice(0, 1).toUpperCase()}</div>}
                    <div className="item-copy">
                      <div>
                        <b>{i.title}</b>
                        <span className={`status ${i.status}`}>{i.status}</span>
                        {i.featured ? <span className="status featured">★ featured</span> : null}
                        {cfg.type === "other" ? <span className="status">{i.type}</span> : null}
                      </div>
                      <p>{i.subtitle ? `${i.subtitle} · ` : ""}{i.description || "No description added."}</p>
                      <small>
                        Added {fmtDate(i.created_at)}
                        {i.updated_at ? ` · edited ${fmtDate(i.updated_at)}` : ""}
                        {i.type === "blog" && i.slug ? (
                          <>
                            {" · "}
                            <a href={`/blog/${i.slug}`} target="_blank" rel="noopener noreferrer">
                              /blog/{i.slug}
                            </a>
                          </>
                        ) : null}
                      </small>
                    </div>
                    <div className="item-actions">
                      {upgraded && cfg.type !== "other" && !query && statusFilter === "all" ? (
                        <span className="reorder">
                          <button onClick={() => move(i, -1)} disabled={idx === 0} aria-label={`Move ${i.title} up`}>
                            ↑
                          </button>
                          <button onClick={() => move(i, 1)} disabled={idx === shown.length - 1} aria-label={`Move ${i.title} down`}>
                            ↓
                          </button>
                        </span>
                      ) : null}
                      {cfg.type === "project" && upgraded ? (
                        <button
                          className={i.featured ? "star on" : "star"}
                          onClick={() => patch({ action: "featured", id: i.id, featured: !i.featured }, i.featured ? "Removed from homepage." : "Added to homepage.")}
                          aria-label={i.featured ? `Remove ${i.title} from homepage` : `Feature ${i.title} on homepage`}
                          title={i.featured ? "Featured on homepage" : "Feature on homepage"}
                        >
                          ★
                        </button>
                      ) : null}
                      <select value={i.status} onChange={(e) => patch({ action: "status", id: i.id, status: e.target.value }, `Marked as ${e.target.value}.`)} aria-label={`Status of ${i.title}`}>
                        <option value="published">Published</option>
                        <option value="draft">Draft</option>
                      </select>
                      <button onClick={() => setEditing({ type: i.type, item: i })}>Edit</button>
                      {isOwner ? (
                        <button className="danger" onClick={() => askDelete(i.title, `/api/admin/content?id=${i.id}`, "Deleted.")}>
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))
              ) : (
                <Empty text={query || statusFilter !== "all" ? "No items match your filters." : `Create your first ${cfg.singular} with the button above.`} />
              )}
            </div>
          </div>
        ) : active === "media" ? (
          <MediaView data={data} upgraded={upgraded} isOwner={isOwner} notify={notify} reload={load} askDelete={askDelete} />
        ) : active === "site" && isOwner ? (
          <SiteSettings data={data} upgraded={upgraded} notify={notify} reload={load} />
        ) : active === "messages" && isOwner ? (
          <Messages data={data} unread={unread} patch={patch} askDelete={askDelete} />
        ) : active === "team" && isOwner ? (
          <Team data={data} upgraded={upgraded} run={run} askDelete={askDelete} />
        ) : active === "database" && isOwner ? (
          <DatabaseView data={data} notify={notify} reload={load} />
        ) : (
          <Empty text="This section is not available for your role." />
        )}
      </section>

      {editing ? (
        <Modal title={`${editing.item ? "Edit" : "New"} ${TYPES.find((t) => t.type === editing.type)?.singular ?? editing.type}`} onClose={() => setEditing(null)} wide>
          <ItemEditor
            type={editing.type}
            item={editing.item}
            upgraded={upgraded}
            onCancel={() => setEditing(null)}
            notify={notify}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        </Modal>
      ) : null}

      {confirm ? (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="confirm-text">{confirm.text}</p>
          <footer className="modal-footer">
            <button className="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="danger-solid"
              onClick={async () => {
                const a = confirm.action;
                setConfirm(null);
                await a();
              }}
            >
              Delete
            </button>
          </footer>
        </Modal>
      ) : null}

      <div className="admin-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`admin-toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            {t.kind === "ok" ? "✓" : "!"} {t.text}
          </div>
        ))}
      </div>
    </main>
  );
}

// ---------- Views ----------
function Overview({ data, days, setDays, onNav, isOwner, unread }: { data: Data; days: number; setDays: (n: number) => void; onNav: (k: string) => void; isOwner: boolean; unread: number }) {
  const s = data.analytics.summary;
  const published = data.items.filter((i) => i.status === "published").length;
  const drafts = data.items.filter((i) => i.status === "draft").length;
  const featured = data.items.filter((i) => i.type === "project" && i.featured && i.status === "published").length;
  const recent = [
    ...data.items.map((i) => ({ title: i.title, meta: `${i.type} · ${i.status}`, date: i.updated_at || i.created_at, kind: "content" })),
    ...data.messages.map((m) => ({ title: m.subject, meta: `Message from ${m.name}`, date: m.created_at, kind: "message" })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  return (
    <div className="dashboard-stack">
      <div className="admin-kpis">
        <article className="violet-kpi">
          <div>
            <span>Page views</span>
            <b>{Number(s?.inRange || 0).toLocaleString()}</b>
            <small>Last {days} days · {Number(s?.total || 0).toLocaleString()} all time</small>
          </div>
          <i aria-hidden="true">↗</i>
        </article>
        <article>
          <div>
            <span>Unique visitors</span>
            <b>{Number(s?.visitors || 0).toLocaleString()}</b>
            <small>Browser sessions, all time</small>
          </div>
          <i aria-hidden="true">◎</i>
        </article>
        <article>
          <div>
            <span>Views today</span>
            <b>{Number(s?.today || 0).toLocaleString()}</b>
            <small>Since midnight UTC</small>
          </div>
          <i aria-hidden="true">◷</i>
        </article>
        {isOwner ? (
          <article>
            <div>
              <span>Unread messages</span>
              <b>{unread}</b>
              <small>{data.messages.length} total enquiries</small>
            </div>
            <i aria-hidden="true">✉</i>
          </article>
        ) : (
          <article>
            <div>
              <span>Featured projects</span>
              <b>{featured}/6</b>
              <small>On the homepage</small>
            </div>
            <i aria-hidden="true">★</i>
          </article>
        )}
      </div>
      <div className="admin-chart-grid">
        <article className="admin-panel-card chart-large">
          <div className="panel-heading">
            <div>
              <span>TRAFFIC ANALYTICS</span>
              <h2>Visitor activity</h2>
            </div>
            <div className="range-toggle" role="group" aria-label="Date range">
              {[7, 30, 90].map((d) => (
                <button key={d} className={d === days ? "active" : ""} aria-pressed={d === days} onClick={() => setDays(d)}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <TrendChart data={data.analytics.daily} />
        </article>
        <article className="admin-panel-card">
          <div className="panel-heading">
            <div>
              <span>CONTENT MIX</span>
              <h2>Portfolio content</h2>
            </div>
          </div>
          <Donut items={data.items} />
        </article>
      </div>
      <div className="admin-bottom-grid">
        <article className="admin-panel-card">
          <div className="panel-heading">
            <div>
              <span>TOP PAGES</span>
              <h2>Most visited</h2>
            </div>
            <small>Last {days} days</small>
          </div>
          <Bars rows={data.analytics.pages} empty="Traffic will appear as people visit your pages." />
        </article>
        <article className="admin-panel-card">
          <div className="panel-heading">
            <div>
              <span>TRAFFIC SOURCES</span>
              <h2>Referrers</h2>
            </div>
          </div>
          <Bars rows={data.analytics.referrers} empty={data.schemaVersion >= 1 ? "Referrers appear for new visits." : "Available after the database upgrade."} />
        </article>
        <article className="admin-panel-card">
          <div className="panel-heading">
            <div>
              <span>AUDIENCE</span>
              <h2>Countries &amp; devices</h2>
            </div>
          </div>
          <Bars rows={[...data.analytics.countries, ...data.analytics.devices]} empty={data.schemaVersion >= 1 ? "Appears for new visits." : "Available after the database upgrade."} />
        </article>
        <article className="admin-panel-card">
          <div className="panel-heading">
            <div>
              <span>RECENT ACTIVITY</span>
              <h2>Latest updates</h2>
            </div>
          </div>
          <div className="recent-list">
            {recent.length ? (
              recent.map((r, i) => (
                <div key={i}>
                  <i className={r.kind} />
                  <span>
                    <b>{r.title}</b>
                    <small>{r.meta}</small>
                  </span>
                  <time>{new Date(r.date).toLocaleDateString("en", { month: "short", day: "numeric" })}</time>
                </div>
              ))
            ) : (
              <Empty text="New content and messages will appear here." />
            )}
          </div>
        </article>
      </div>
      <div className="content-health">
        <div>
          <span>Published content</span>
          <b>{published}</b>
          <i style={{ width: `${data.items.length ? (published / data.items.length) * 100 : 0}%` }} />
        </div>
        <div>
          <span>Draft content</span>
          <b>{drafts}</b>
          <i className="amber-bar" style={{ width: `${data.items.length ? (drafts / data.items.length) * 100 : 0}%` }} />
        </div>
        <div>
          <span>Homepage featured</span>
          <b>
            <button className="link-button" onClick={() => onNav("projects")}>
              {featured}/6
            </button>
          </b>
          <i className="green-bar" style={{ width: `${(Math.min(6, featured) / 6) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function MediaView({ data, upgraded, isOwner, notify, reload, askDelete }: { data: Data; upgraded: boolean; isOwner: boolean; notify: (k: Toast["kind"], t: string) => void; reload: () => Promise<void>; askDelete: (t: string, u: string, ok: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    let ok = 0;
    for (const file of files) {
      try {
        const blob = await prepareImage(file);
        const fd = new FormData();
        fd.append("file", blob, file.name);
        await api("/api/admin/media", { method: "POST", body: fd });
        ok++;
      } catch (err) {
        notify("error", `${file.name}: ${(err as Error).message}`);
      }
    }
    setBusy(false);
    if (ok) notify("ok", `${ok} image${ok > 1 ? "s" : ""} uploaded.`);
    reload();
  }
  if (!upgraded) return <Empty text="Image uploads are available after the database upgrade (Database & backup)." />;
  return (
    <div className="admin-content-view">
      <div className="content-toolbar">
        <div>
          <h2>Media library</h2>
          <p>Upload images, then copy a path into a project or post — or upload directly from the editor.</p>
        </div>
        <label className="primary-action upload-button">
          {busy ? "Uploading…" : "+ Upload images"}
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={upload} disabled={busy} hidden />
        </label>
      </div>
      {data.media.length ? (
        <div className="media-grid">
          {data.media.map((m) => (
            <figure key={m.id}>
              <img src={`/media/${m.id}`} alt={m.alt || m.filename} loading="lazy" />
              <figcaption>
                <b title={m.filename}>{m.filename}</b>
                <small>
                  {fmtBytes(m.size)} · {fmtDate(m.created_at)}
                </small>
                <span>
                  <button
                    className="link-button"
                    onClick={() => {
                      navigator.clipboard?.writeText(`/media/${m.id}`).then(() => notify("ok", "Image path copied."), () => notify("error", "Copy failed."));
                    }}
                  >
                    Copy path
                  </button>
                  {isOwner ? (
                    <button className="link-button danger" onClick={() => askDelete(m.filename, `/api/admin/media?id=${encodeURIComponent(m.id)}`, "Image deleted.")}>
                      Delete
                    </button>
                  ) : null}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <Empty text="Uploaded images will appear here." />
      )}
    </div>
  );
}

function SiteSettings({ data, upgraded, notify, reload }: { data: Data; upgraded: boolean; notify: (k: Toast["kind"], t: string) => void; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/admin/settings", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });
      notify("ok", "Site text saved. Changes are live.");
      reload();
    } catch (err) {
      notify("error", (err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (!upgraded) return <Empty text="Editable site text is available after the database upgrade (Database & backup)." />;
  return (
    <form className="admin-content-view settings-form" onSubmit={submit}>
      {SETTINGS_GROUPS.map((g) => (
        <fieldset key={g.title} className="admin-panel-card">
          <legend>{g.title}</legend>
          <div className="field-grid">
            {g.fields.map((f) => (
              <label key={f.key} className={f.long ? "span-2" : ""}>
                {f.label}
                {f.long ? <textarea name={f.key} defaultValue={data.settings[f.key] ?? ""} rows={f.key === "bio" ? 6 : 3} /> : <input name={f.key} defaultValue={data.settings[f.key] ?? ""} />}
                {f.hint ? <small>{f.hint}</small> : null}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="sticky-save">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save site text"}
        </button>
      </div>
    </form>
  );
}

function Messages({ data, unread, patch, askDelete }: { data: Data; unread: number; patch: (b: Record<string, unknown>, ok: string) => void; askDelete: (t: string, u: string, ok: string) => void }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const list = data.messages
    .filter((m) => filter === "all" || m.status === filter)
    .filter((m) => !q || `${m.name} ${m.email} ${m.subject} ${m.message}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="admin-content-view">
      <div className="content-toolbar">
        <div>
          <h2>Inbox</h2>
          <p>Review and manage portfolio enquiries.</p>
        </div>
        <span>{unread} unread</span>
      </div>
      <div className="list-filters">
        <input type="search" placeholder="Search messages…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search messages" />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter messages">
          <option value="all">All ({data.messages.length})</option>
          <option value="unread">Unread ({unread})</option>
          <option value="read">Read</option>
        </select>
      </div>
      <div className="message-list">
        {list.length ? (
          list.map((m) => (
            <article className={m.status === "unread" ? "unread" : ""} key={m.id}>
              <div className="message-avatar" aria-hidden="true">
                {m.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="message-copy">
                <div>
                  <b>{m.subject}</b>
                  <time>{new Date(m.created_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</time>
                </div>
                <span>
                  {m.name} · <a href={`mailto:${m.email}`}>{m.email}</a>
                </span>
                <p>{m.message}</p>
                <div>
                  <button onClick={() => patch({ action: "message-status", id: m.id, status: m.status === "unread" ? "read" : "unread" }, m.status === "unread" ? "Marked as read." : "Marked as unread.")}>
                    {m.status === "unread" ? "Mark as read" : "Mark as unread"}
                  </button>
                  <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`}>Reply ↗</a>
                  <button className="danger" onClick={() => askDelete(m.subject, `/api/admin/content?id=${m.id}&table=messages`, "Message deleted.")}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <Empty text={data.messages.length ? "No messages match your filters." : "Messages sent from the contact page will appear here."} />
        )}
      </div>
    </div>
  );
}

function Team({ data, upgraded, run, askDelete }: { data: Data; upgraded: boolean; run: (a: () => Promise<unknown>, ok: string) => Promise<void>; askDelete: (t: string, u: string, ok: string) => void }) {
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email") || "");
    await run(() => api("/api/admin/users", { method: "POST", body: JSON.stringify({ email }) }), `${email} can now sign in as an editor.`);
    form.reset();
  }
  return (
    <div className="admin-content-view">
      <div className="content-toolbar">
        <div>
          <h2>Team &amp; access</h2>
          <p>People sign in with their own ChatGPT account. Turn on multi-factor authentication in that account&apos;s security settings.</p>
        </div>
      </div>
      <div className="role-table admin-panel-card">
        <div>
          <b>Owner</b>
          <span>Everything, including deleting, messages, site text, team, backups and upgrades.</span>
        </div>
        <div>
          <b>Editor</b>
          <span>Create and edit content, change status, feature and reorder, upload images. Cannot delete, read messages or change settings.</span>
        </div>
      </div>
      <div className="admin-list pro-list">
        <article>
          <div className="item-icon">{data.me.email.slice(0, 1).toUpperCase()}</div>
          <div className="item-copy">
            <div>
              <b>{data.me.role === "owner" ? data.me.email : "Owner"}</b>
              <span className="status published">owner</span>
            </div>
            <p>Fixed owner account. Cannot be removed.</p>
          </div>
        </article>
        {data.users.map((u) => (
          <article key={u.email}>
            <div className="item-icon">{u.email.slice(0, 1).toUpperCase()}</div>
            <div className="item-copy">
              <div>
                <b>{u.email}</b>
                <span className="status draft">{u.role}</span>
              </div>
              <small>Added {fmtDate(u.created_at)}</small>
            </div>
            <div className="item-actions">
              <button className="danger" onClick={() => askDelete(u.email, `/api/admin/users?email=${encodeURIComponent(u.email)}`, "Editor removed.")}>
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>
      {upgraded ? (
        <form className="admin-form pro-form inline-form" onSubmit={add}>
          <label>
            Invite editor by email
            <input name="email" type="email" required placeholder="name@example.com" />
          </label>
          <button>Add editor</button>
        </form>
      ) : (
        <p className="editor-note">Editors can be added after the database upgrade.</p>
      )}
    </div>
  );
}

function DatabaseView({ data, notify, reload }: { data: Data; notify: (k: Toast["kind"], t: string) => void; reload: () => Promise<void> }) {
  const [backup, setBackup] = useState<{ sha: string; counts: Record<string, number>; at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const upgraded = data.schemaVersion >= 1;

  async function download() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/backup");
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "Backup failed.");
      const sha = r.headers.get("x-backup-sha256") || "";
      const counts = JSON.parse(r.headers.get("x-backup-counts") || "{}");
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] || "portfolio-backup.sql";
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setBackup({ sha, counts, at: new Date().toLocaleString() });
      setSaved(false);
      notify("ok", "Backup downloaded. Keep the file somewhere safe.");
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upgrade() {
    if (!backup) return;
    setBusy(true);
    try {
      const r = await api<{ report: Record<string, unknown> }>("/api/admin/upgrade", { method: "POST", body: JSON.stringify({ backupSha256: backup.sha, confirm: phrase }) });
      setReport(r.report);
      notify("ok", "Database upgraded. All original records were kept.");
      reload();
    } catch (e) {
      notify("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-content-view db-view">
      <div className="content-toolbar">
        <div>
          <h2>Database &amp; backup</h2>
          <p>
            Schema version <b>{data.schemaVersion}</b>
            {upgraded ? " · up to date" : " · upgrade available"}
          </p>
        </div>
      </div>

      <article className="admin-panel-card step-card">
        <span className="step-n">1</span>
        <div>
          <h3>Download a full backup</h3>
          <p>A read-only export of every table: content, messages, analytics, settings and images stored in the database. Restorable with SQLite or Cloudflare D1.</p>
          <button className="primary" onClick={download} disabled={busy}>
            {busy && !backup ? "Preparing…" : "Download backup (.sql)"}
          </button>
          {backup ? (
            <div className="backup-proof">
              <p>
                <b>Downloaded {backup.at}</b>
              </p>
              <p>
                Rows: {Object.entries(backup.counts).map(([t, n]) => `${t} ${n}`).join(" · ")}
              </p>
              <p className="mono">SHA-256 {backup.sha}</p>
            </div>
          ) : null}
        </div>
      </article>

      {!upgraded ? (
        <article className="admin-panel-card step-card">
          <span className="step-n">2</span>
          <div>
            <h3>Apply the upgrade (v1)</h3>
            <p>
              Adds new columns and tables only — nothing is deleted or overwritten. Your original portfolio content is added as editable entries (skipping anything already
              published with the same title). The server checks that your backup matches the database exactly before changing anything.
            </p>
            <label className="check">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} disabled={!backup} />
              I have saved the backup file somewhere safe.
            </label>
            <label>
              Type <b>UPGRADE</b> to confirm
              <input value={phrase} onChange={(e) => setPhrase(e.target.value)} disabled={!backup || !saved} autoComplete="off" />
            </label>
            <button className="primary" onClick={upgrade} disabled={!backup || !saved || phrase !== "UPGRADE" || busy}>
              {busy ? "Upgrading…" : "Apply upgrade"}
            </button>
          </div>
        </article>
      ) : null}

      {report ? (
        <article className="admin-panel-card">
          <h3>Upgrade report</h3>
          <pre className="mono">{JSON.stringify(report, null, 2)}</pre>
        </article>
      ) : null}

      {data.audit.length ? (
        <article className="admin-panel-card">
          <div className="panel-heading">
            <div>
              <span>AUDIT LOG</span>
              <h2>Recent admin actions</h2>
            </div>
          </div>
          <div className="recent-list">
            {data.audit.map((a, i) => (
              <div key={i}>
                <i className="content" />
                <span>
                  <b>
                    {a.action} {a.entity}
                    {a.entity_id ? ` #${a.entity_id}` : ""}
                  </b>
                  <small>{a.actor}</small>
                </span>
                <time>{new Date(a.created_at).toLocaleString("en", { dateStyle: "short", timeStyle: "short" })}</time>
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </div>
  );
}
