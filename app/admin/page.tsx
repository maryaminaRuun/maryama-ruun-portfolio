import type { Metadata } from "next";
import { getAdminSession, OWNER_EMAIL } from "../../lib/admin";
import { hasAccount } from "../../lib/auth/accounts";
import { authSecret } from "../../lib/auth/crypto";
import { setupKeyConfigured } from "../../lib/auth/flows";
import { ensureAppSchema } from "../../lib/db/schema";
import { getEnvDb } from "../../lib/db/types";
import AdminPanel from "./AdminPanel";
import AdminLogin from "./AdminLogin";
import { AuthCard } from "./AuthCard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminPage() {
  let problem: string | null = null;
  try {
    authSecret();
  } catch (e) {
    problem = (e as Error).message;
  }
  const db = problem ? null : await getEnvDb().catch((e: Error) => ((problem = e.message), null));
  if (!db || problem) {
    return (
      <AuthCard title="Admin is not configured yet">
        <p className="auth-note">{problem}</p>
        <p className="auth-note">After adding the setting in Vercel, redeploy the preview and reload this page.</p>
      </AuthCard>
    );
  }
  await ensureAppSchema(db);
  const session = await getAdminSession(db);
  if (session) return <AdminPanel name={session.name} role={session.role} />;
  const ownerExists = await hasAccount(db, OWNER_EMAIL);
  return <AdminLogin ownerExists={ownerExists} setupAvailable={setupKeyConfigured()} />;
}
