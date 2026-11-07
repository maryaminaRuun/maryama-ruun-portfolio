// Read-only checks against a deployed Vercel Preview. Never writes data.
// Env: PREVIEW_URL, optional VERCEL_AUTOMATION_BYPASS_SECRET (Deployment Protection bypass).
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const B = (process.env.PREVIEW_URL || "").replace(/\/$/, "");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const headers = bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : {};
mkdirSync("preview-screenshots", { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ extraHTTPHeaders: headers, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const first = await page.request.get(B + "/");
if (first.status() === 401 || /vercel\.com\/login|Authentication Required/i.test(await first.text())) {
  console.log("BLOCKED  Preview is behind Vercel Deployment Protection. Add VERCEL_AUTOMATION_BYPASS_SECRET as a GitHub Actions secret.");
  process.exit(2);
}
for (const p of ["/", "/about", "/projects", "/services", "/blog", "/blog/building-digniinai", "/contact", "/sitemap.xml", "/robots.txt"]) {
  const r = await page.request.get(B + p);
  check(`GET ${p}`, r.status() === 200, String(r.status()));
}
await page.goto(B + "/", { waitUntil: "networkidle" });
check("homepage shows exactly 6 projects", (await page.locator(".featured-grid .project-card").count()) === 6);
check("no broken images on homepage", (await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length)) === 0);
await page.screenshot({ path: "preview-screenshots/home.png", fullPage: true });
await page.goto(B + "/admin");
const adminText = await page.locator("body").innerText();
const adminState = /Sign in/.test(adminText) ? "sign-in" : /Set up the admin|Create the owner/.test(adminText) ? "owner setup" : /not configured/i.test(adminText) ? "not configured" : "unknown";
check("admin page loads", adminState !== "unknown", adminState);
console.log(`ADMIN_STATE ${adminState}: ${adminText.replace(/\s+/g, " ").slice(0, 300)}`);
await page.screenshot({ path: "preview-screenshots/admin.png" });
check("admin API locked without session", [401, 503].includes((await page.request.get(B + "/api/admin/content")).status()));
const hdr = (await page.request.get(B + "/")).headers();
check("security headers present", hdr["x-content-type-options"] === "nosniff" && hdr["x-frame-options"] === "DENY");
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\nPREVIEW: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
