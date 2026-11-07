import { getSiteContent } from "../../lib/content";

export const dynamic = "force-dynamic";

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);

export async function GET(request: Request) {
  const c = await getSiteContent();
  const origin = new URL(request.url).origin;
  const paths = ["/", "/about", "/projects", "/services", "/blog", "/contact", ...c.posts.map((p) => `/blog/${p.slug}`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
    .map((p) => `  <url><loc>${escapeXml(origin + p)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
