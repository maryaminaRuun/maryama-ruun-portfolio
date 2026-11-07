// End-to-end browser test against a running build (`next start`).
// Env: E2E_BASE_URL (default http://localhost:3100), ADMIN_SETUP_KEY (same as the server).
// Covers: public pages, owner setup with MFA, backup import, every admin action,
// image upload, editor invite + MFA, roles, sign-in with recovery code, security checks.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const B = process.env.E2E_BASE_URL || "http://localhost:3100";
const SETUP_KEY = process.env.ADMIN_SETUP_KEY;
const OWNER = "ruun4646@gmail.com";
const OWNER_PW = "Mogadishu-Portfolio-E2E-2026!";
const EDITOR = "editor@example.com";
const EDITOR_PW = "Editor-Strong-Passphrase-77";
const SHOTS = "e2e-screenshots";
mkdirSync(SHOTS, { recursive: true });

const results = [];
let currentStep = "start";
const step = (name) => {
  currentStep = name;
  console.log(`--- ${name}`);
};
const openPages = [];
const check = (name, ok, extra = "") => {
  results.push([ok ? "PASS" : "FAIL", name, extra]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`);
};

// ---- TOTP (RFC 6238) for the test's "authenticator app" ----
function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.replace(/\s/g, "").toUpperCase()) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, step) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = mac[mac.length - 1] & 15;
  return String(((mac.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
const usedSteps = new Map();
/** Next code for this secret that hasn't been used (codes can't be replayed). */
async function freshCode(secret) {
  for (;;) {
    const step = Math.floor(Date.now() / 30000);
    if (step > (usedSteps.get(secret) ?? 0)) { usedSteps.set(secret, step); return totp(secret, step); }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  openPages.push(["owner", page]);
  const consoleErrors = [];
  const expected = /Failed to load resource: .*(40[0139]|409|429|503)/;
  page.on("console", (m) => m.type() === "error" && !expected.test(m.text()) && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  const seen = new Set();
  const toast = async (re) => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      for (const t of await page.locator(".admin-toast").allTextContents()) if (!seen.has(t) && re.test(t)) { seen.add(t); await page.waitForTimeout(300); return true; }
      await page.waitForTimeout(100);
    }
    return false;
  };
  const nav = (label) => page.locator("aside nav button", { hasText: label }).first().click();

  // ---------- Public pages ----------
  for (const p of ["/", "/about", "/projects", "/services", "/blog", "/blog/building-digniinai", "/contact", "/sitemap.xml", "/robots.txt"]) {
    const r = await page.request.get(B + p);
    check(`GET ${p} → 200`, r.status() === 200, String(r.status()));
  }
  check("unknown page → 404", (await page.request.get(B + "/nope-404")).status() === 404);
  await page.goto(B + "/");
  const homeProjects = await page.locator(".featured-grid .project-card").count();
  check("homepage shows exactly 6 projects (before setup: original content)", homeProjects === 6, String(homeProjects));
  check("contact form waits for database setup (503)", (await page.request.post(B + "/api/contact", { data: { name: "a", email: "a@example.com", subject: "s", message: "m" } })).status() === 503);

  // ---------- Security before sign-in ----------
  check("admin API without session → 401", (await page.request.get(B + "/api/admin/content")).status() === 401);
  check("forged session cookie → 401", (await page.request.get(B + "/api/admin/content", { headers: { cookie: "mr_session=forged" } })).status() === 401);
  check("cross-site login blocked → 403", (await page.request.post(B + "/api/auth/login", { headers: { origin: "https://evil.example" }, data: { email: OWNER, password: "x" } })).status() === 403);
  const bad = await page.request.post(B + "/api/auth/enroll/start", { headers: { origin: B }, data: { mode: "setup", setupKey: "wrong-key-wrong-key", password: OWNER_PW } });
  check("wrong setup key rejected → 403", bad.status() === 403);

  // ---------- Owner setup with MFA ----------
  await page.goto(B + "/admin");
  check("admin offers owner setup", await page.getByRole("link", { name: /Create the owner account/ }).isVisible());
  await page.goto(B + "/admin/setup");
  await page.getByLabel("Setup key").fill(SETUP_KEY);
  await page.getByLabel("New password").fill(OWNER_PW);
  await page.getByLabel("Repeat password").fill(OWNER_PW);
  await page.getByRole("button", { name: /Continue as owner/ }).click();
  await page.locator(".qr-box svg").waitFor();
  check("QR code shown for authenticator app", true);
  await page.screenshot({ path: `${SHOTS}/setup-qr.png` });
  await page.getByText("Can't scan?").click();
  const ownerSecret = (await page.locator(".secret-key").textContent()).replace(/\s/g, "");
  await page.getByLabel(/6-digit code/).fill(totp(ownerSecret, Math.floor(Date.now() / 30000) - 5));
  await page.getByRole("button", { name: /Confirm and finish/ }).click();
  check("wrong authenticator code rejected", await page.locator(".auth-error").isVisible().catch(() => false) || (await page.locator(".auth-error").waitFor({ timeout: 5000 }).then(() => true, () => false)));
  await page.getByLabel(/6-digit code/).fill(await freshCode(ownerSecret));
  await page.getByRole("button", { name: /Confirm and finish/ }).click();
  await page.locator(".recovery-codes").waitFor();
  const recovery = (await page.locator(".recovery-codes code").allTextContents()).map((s) => s.trim());
  check("8 recovery codes shown once", recovery.length === 8);
  await page.getByLabel(/I saved these codes/).check();
  await page.getByRole("link", { name: /Open the dashboard/ }).click();
  await page.locator(".admin-kpis").waitFor();
  check("owner signed in after setup", true);
  check("setup banner shown on empty database", await page.locator(".admin-banner", { hasText: "Set up the database" }).isVisible());

  // ---------- Import backup ----------
  await nav("Database");
  await page.locator('input[type=file][accept=".sql,text/plain"]').setInputFiles("tests/e2e/fixtures/live-v0-backup.sql");
  await page.locator(".backup-proof").waitFor();
  check("backup fingerprint verified before import", /fingerprint verified/.test(await page.locator(".backup-proof").textContent()));
  await page.getByLabel(/Type IMPORT/).fill("IMPORT");
  await page.screenshot({ path: `${SHOTS}/import.png`, fullPage: true });
  await page.getByRole("button", { name: "Import backup" }).click();
  check("import succeeds and is verified row by row", await toast(/imported and verified/));
  await page.waitForTimeout(800);
  const content = await (await page.request.get(B + "/api/admin/content")).json();
  check("imported: 2 messages, 242 page views, admin-added service", content.messages.length === 2 && Number(content.analytics.summary.total) === 242 && content.items.some((i) => i.title === "web develpment"));
  const msg = content.messages.find((m) => m.name === "Amina Hassan");
  check("multi-line message text preserved exactly", msg?.message === "Hi Maryama, we need a bilingual website for our NGO.\nCan we talk next week?");
  const services = await (await page.request.get(B + "/services")).text();
  check("live order preserved: admin-added service listed first", services.indexOf("web develpment") > -1 && services.indexOf("web develpment") < services.indexOf("Full-Stack Development"));
  check("second import refused (database has content)", (await page.request.post(B + "/api/admin/database?action=import", { headers: { origin: B, "content-type": "text/plain" }, data: readFileSync("tests/e2e/fixtures/live-v0-backup.sql", "utf8") })).status() === 400);

  // ---------- Projects ----------
  await nav("Projects");
  await page.locator(".featured-meter").waitFor();
  check("10 projects, 6 featured", (await page.locator(".pro-list article").count()) === 10 && /6\/6/.test(await page.locator(".featured-meter").textContent()));
  await page.locator(".pro-list article", { hasText: "VoltX" }).locator("button.star").click();
  check("7th featured project refused", await toast(/exactly 6/));
  await page.getByRole("button", { name: "+ New project" }).click();
  await page.getByLabel("Project name").fill("Hodan Blood Bank");
  await page.getByLabel("Category tag").fill("Healthcare · ERPNext");
  await page.getByLabel("Short description").fill("Blood request workflow built on Frappe custom doctypes.");
  await page.getByLabel("Link URL").fill("https://example.com/bloodbank");
  await page.locator(".image-field input[type=file]").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: readFileSync("public/maryama-ruun.png") });
  check("image upload works", await toast(/uploaded/i));
  const imgSrc = await page.locator(".image-field img").getAttribute("src");
  await page.getByRole("button", { name: "Create project" }).click();
  check("project created", await toast(/created/i));
  const img = await page.request.get(B + imgSrc, { maxRedirects: 5 });
  check("uploaded image served", img.status() === 200 && /image\//.test(img.headers()["content-type"] || ""), `${imgSrc} ${img.headers()["content-type"]}`);
  await page.locator(".pro-list article", { hasText: "Hodan Blood Bank" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Project name").fill("Hodan Hospital Blood Bank");
  await page.getByRole("button", { name: "Save changes" }).click();
  check("project edited", await toast(/saved/i));
  await page.locator(".pro-list article", { hasText: "FarmFlow" }).locator("button.star").click();
  await toast(/Removed/);
  await page.locator(".pro-list article", { hasText: "Hodan Hospital Blood Bank" }).locator("button.star").click();
  check("feature new project", await toast(/Added to homepage/));
  const home = await (await page.request.get(B + "/")).text();
  const titles = [...home.matchAll(/<article class="project-card">[\s\S]*?<h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
  check("homepage: exactly 6, includes new project", titles.length === 6 && titles.includes("Hodan Hospital Blood Bank") && !titles.includes("FarmFlow ERP"), titles.join(" | "));
  const first = await page.locator(".pro-list article .item-copy b").first().textContent();
  await page.locator(".pro-list article").nth(1).getByRole("button", { name: /Move .* up/ }).click();
  await toast(/Order updated/);
  check("reorder works", first !== (await page.locator(".pro-list article .item-copy b").first().textContent()));
  await page.locator(".pro-list article", { hasText: "Hodan Hospital Blood Bank" }).locator("select").selectOption("draft");
  await toast(/draft/);
  check("draft hidden publicly", !(await (await page.request.get(B + "/projects")).text()).includes("Hodan Hospital Blood Bank"));
  await page.locator(".pro-list article", { hasText: "Hodan Hospital Blood Bank" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  check("delete via confirm dialog", await toast(/Deleted/));

  // ---------- Blog, services, site text, messages ----------
  await nav("Blog posts");
  await page.getByRole("button", { name: "+ New post" }).click();
  await page.getByLabel("Post title").fill("Moving a portfolio to Vercel safely");
  await page.getByLabel("Category").fill("Engineering");
  await page.getByLabel(/Excerpt/).fill("Backups first, verified imports second.");
  await page.getByLabel(/Article body/).fill("First paragraph.\n\nSecond paragraph.");
  await page.getByRole("button", { name: "Create post" }).click();
  check("blog post created", await toast(/created/i));
  const post = await page.request.get(B + "/blog/moving-a-portfolio-to-vercel-safely");
  check("new post page renders", post.status() === 200 && (await post.text()).includes("Second paragraph."));
  await nav("Services");
  await page.locator(".pro-list article", { hasText: "web develpment" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Service name").fill("Web Development");
  await page.getByLabel(/Bullet points/).fill("Websites, Web apps, APIs");
  await page.getByRole("button", { name: "Save changes" }).click();
  await toast(/saved/i);
  check("imported service editable", (await (await page.request.get(B + "/services")).text()).includes("Web apps"));
  await nav("Site text");
  await page.getByLabel("LinkedIn URL").fill("https://www.linkedin.com/in/maryama-ruun");
  await page.getByRole("button", { name: "Save site text" }).click();
  check("site text saved", await toast(/saved/i));
  check("LinkedIn shown on homepage", (await (await page.request.get(B + "/")).text()).includes("linkedin.com/in/maryama-ruun"));
  await nav("Messages");
  await page.locator(".message-list article.unread").first().getByRole("button", { name: "Mark as read" }).click();
  await toast(/read/);
  check("message marked read", (await page.locator(".message-list article.unread").count()) === 0);
  const contact = await page.request.post(B + "/api/contact", { data: { name: "Test", email: "t@example.com", subject: "Hello", message: "From e2e" } });
  check("contact form works after setup", contact.status() === 200);

  // ---------- Backup export ----------
  await nav("Database");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup (.sql)" }).click()]);
  const sql = readFileSync(await dl.path(), "utf8");
  check("backup export has all data and no login secrets", /contact_messages/.test(sql) && /page_views/.test(sql) && !/admin_accounts|admin_sessions|pbkdf2/.test(sql));

  // ---------- Security page ----------
  await nav("My security");
  await page.getByText("Where you're signed in").waitFor();
  check("security page lists this session", await page.getByText("This browser").isVisible());
  await page.locator("form", { hasText: "Recovery codes" }).getByLabel("Authenticator code").fill(await freshCode(ownerSecret));
  await page.getByRole("button", { name: "Create new codes" }).click();
  check("recovery codes regenerated with authenticator code", await toast(/New recovery codes/));
  const newRecovery = (await page.locator(".admin-content-view .recovery-codes code").allTextContents()).map((s) => s.trim());

  // ---------- Editor invite ----------
  await nav("Team");
  await page.getByLabel("Invite editor by email").fill(EDITOR);
  await page.getByRole("button", { name: "Invite editor" }).click();
  check("invite link created", await toast(/Invite link created/));
  const inviteUrl = await page.locator(".invite-card input").inputValue();
  await page.screenshot({ path: `${SHOTS}/admin-team.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".admin-menu").click();
  await nav("Overview");
  await page.locator(".admin-kpis").waitFor();
  await page.screenshot({ path: `${SHOTS}/admin-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  step("editor invite flow");

  const ectx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const ep = await ectx.newPage();
  openPages.push(["editor", ep]);
  ep.on("pageerror", (e) => consoleErrors.push(`editor: ${e}`));
  await ep.goto(inviteUrl);
  await ep.getByLabel("New password").fill(EDITOR_PW);
  await ep.getByLabel("Repeat password").fill(EDITOR_PW);
  await ep.getByRole("button", { name: /Continue as editor/ }).click();
  await ep.getByText("Can't scan?").click();
  const editorSecret = (await ep.locator(".secret-key").textContent()).replace(/\s/g, "");
  await ep.getByLabel(/6-digit code/).fill(await freshCode(editorSecret));
  await ep.getByRole("button", { name: /Confirm and finish/ }).click();
  await ep.locator(".recovery-codes").waitFor();
  await ep.getByLabel(/I saved these codes/).check();
  await ep.getByRole("link", { name: /Open the dashboard/ }).click();
  await ep.locator(".admin-kpis").waitFor();
  check("editor enrolled with MFA and signed in", (await ep.locator(".admin-owner small").textContent()) === "Editor");
  check("editor has no Messages section", (await ep.locator("aside nav button", { hasText: "Messages" }).count()) === 0);
  const edApi = await (await ep.request.get(B + "/api/admin/content")).json();
  check("editor API: no messages", edApi.me.role === "editor" && edApi.messages.length === 0);
  check("editor cannot delete (403)", (await ep.request.delete(B + "/api/admin/content?id=1", { headers: { origin: B } })).status() === 403);
  check("editor cannot download backup (403)", (await ep.request.get(B + "/api/admin/backup")).status() === 403);
  check("invite link cannot be reused", (await ep.request.post(B + "/api/auth/enroll/start", { headers: { origin: B }, data: { mode: "invite", token: new URL(inviteUrl).searchParams.get("token"), password: EDITOR_PW } })).status() === 403);
  await ectx.close();

  step("sign out and recovery-code sign-in");
  // ---------- Sign out, sign in with a recovery code ----------
  await page.locator(".admin-signout").click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  check("signed out", (await page.request.get(B + "/api/admin/content")).status() === 401);
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Continue" }).click();
  check("wrong password rejected", await page.locator(".auth-error").waitFor({ timeout: 5000 }).then(() => true, () => false));
  await page.getByLabel("Password").fill(OWNER_PW);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Authentication code").fill(recovery[0]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator(".auth-error").waitFor({ timeout: 5000 }).catch(() => {});
  check("old recovery code rejected after regeneration", await page.locator(".auth-error").isVisible());
  await page.getByLabel("Authentication code").fill(newRecovery[0]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator(".admin-kpis").waitFor();
  check("signed in with password + recovery code", true);
  await page.screenshot({ path: `${SHOTS}/admin-overview.png`, fullPage: true });

  // ---------- Public screenshots ----------
  for (const [w, h, tag] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
    const pc = await browser.newContext({ viewport: { width: w, height: h } });
    const pp = await pc.newPage();
    pp.on("pageerror", (e) => consoleErrors.push(`public: ${e}`));
    for (const p of ["/", "/projects", "/about", "/blog", "/contact"]) {
      await pp.goto(B + p, { waitUntil: "networkidle" });
      const overflow = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) check(`no horizontal overflow ${tag} ${p}`, false);
      const broken = await pp.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length);
      if (broken) check(`no broken images ${tag} ${p}`, false, String(broken));
      await pp.screenshot({ path: `${SHOTS}/${tag}${p.replace(/\//g, "_") || "_home"}.png`, fullPage: p === "/" });
    }
    await pc.close();
  }
  check("no console errors anywhere", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
  await browser.close();
}

try {
  await main();
} catch (e) {
  check("e2e run completed", false, `step "${currentStep}": ${String(e?.stack || e).slice(0, 700)}`);
  for (const [name, p] of openPages) {
    await p.screenshot({ path: `${SHOTS}/FAILURE-${name}.png`, fullPage: true }).catch(() => {});
    console.log(`URL at failure (${name}): ${p.url()}`);
    console.log((await p.locator("body").innerText().catch(() => "")).slice(0, 600));
  }
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\nE2E: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
