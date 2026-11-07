import type { Metadata } from "next";
import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import { resolveRole } from "../../lib/admin";
import { ensurePortfolioTables } from "../../lib/portfolio-db";
import AdminPanel from "./AdminPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  const role = await resolveRole(await ensurePortfolioTables().catch(() => null), user.email);
  if (!role) {
    return (
      <main className="admin-denied">
        <h1>Access denied</h1>
        <p>This dashboard is restricted to the portfolio owner and invited editors.</p>
        <p>
          Signed in as <b>{user.email}</b>. <a href={chatGPTSignOutPath("/admin")}>Use a different account</a>
        </p>
        <a href="/">Return to portfolio</a>
      </main>
    );
  }
  return <AdminPanel name={user.displayName} role={role} signOut={chatGPTSignOutPath("/")} />;
}
