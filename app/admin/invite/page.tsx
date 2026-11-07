import type { Metadata } from "next";
import { findInvite } from "../../../lib/auth/accounts";
import { ensureAppSchema } from "../../../lib/db/schema";
import { getEnvDb } from "../../../lib/db/types";
import { AuthCard } from "../AuthCard";
import EnrollFlow from "../EnrollFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editor invite", robots: { index: false, follow: false } };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const db = await getEnvDb().catch(() => null);
  if (db) await ensureAppSchema(db);
  const invite = db ? await findInvite(db, token) : null;
  if (!invite) {
    return (
      <AuthCard title="This invite link doesn't work">
        <p className="auth-note">It may have expired (links last 72 hours) or already been used. Ask the portfolio owner to send a new one.</p>
        <a className="auth-link" href="/admin">Go to sign in</a>
      </AuthCard>
    );
  }
  return <EnrollFlow mode="invite" token={token} email={invite.email} />;
}
