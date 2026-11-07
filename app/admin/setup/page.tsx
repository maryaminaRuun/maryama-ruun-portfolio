import type { Metadata } from "next";
import { setupKeyConfigured } from "../../../lib/auth/flows";
import { AuthCard } from "../AuthCard";
import EnrollFlow from "../EnrollFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin setup", robots: { index: false, follow: false } };

/**
 * Owner setup. Works only while ADMIN_SETUP_KEY is set in the environment.
 * Running it again replaces the owner's password and authenticator (recovery path)
 * and signs out every owner session. Remove the variable after setup to turn this off.
 */
export default function SetupPage() {
  if (!setupKeyConfigured()) {
    return (
      <AuthCard title="Owner setup is turned off">
        <p className="auth-note">To create or reset the owner account, add ADMIN_SETUP_KEY (16+ characters) in Vercel → Settings → Environment Variables, redeploy, and reload this page.</p>
        <a className="auth-link" href="/admin">← Back to sign in</a>
      </AuthCard>
    );
  }
  return <EnrollFlow mode="setup" />;
}
