"use client";
import { FormEvent, useState } from "react";
import { AuthCard } from "./AuthCard";

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as { error?: string; restart?: boolean; usedRecovery?: boolean; recoveryCodesLeft?: number };
  return { ok: r.ok, data };
}

export default function AdminLogin({ ownerExists, setupAvailable }: { ownerExists: boolean; setupAvailable: boolean }) {
  const [step, setStep] = useState<"password" | "mfa">("password");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");

  async function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const r = await post("/api/auth/login", { email: f.get("email"), password: f.get("password") });
    setBusy(false);
    if (r.ok) setStep("mfa");
    else setError(r.data.error || "Sign-in failed.");
  }

  async function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const r = await post("/api/auth/mfa", { code: String(f.get("code") || "").trim() });
    if (r.ok) {
      if (r.data.usedRecovery) alertRecovery(r.data.recoveryCodesLeft ?? 0);
      window.location.reload();
      return;
    }
    setBusy(false);
    if (r.data.restart) setStep("password");
    setError(r.data.error || "That code is not valid.");
  }

  function alertRecovery(left: number) {
    try {
      sessionStorage.setItem("mr-recovery-notice", String(left));
    } catch {}
  }

  if (!ownerExists) {
    return (
      <AuthCard title="Set up the admin" subtitle="No owner account exists yet on this deployment.">
        {setupAvailable ? (
          <a className="auth-primary" href="/admin/setup">
            Create the owner account →
          </a>
        ) : (
          <p className="auth-note">Owner setup is turned off. Add ADMIN_SETUP_KEY (16+ characters) to this Vercel environment, redeploy, then reload this page.</p>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in" subtitle={step === "password" ? "Portfolio owner and editors only." : `Enter the 6-digit code from your authenticator app for ${email}.`}>
      {step === "password" ? (
        <form className="auth-form" onSubmit={submitPassword}>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="auth-primary" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={submitCode}>
          <label>
            Authentication code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required autoFocus maxLength={11} />
          </label>
          <p className="auth-note">Lost your phone? Enter one of your recovery codes (like <code>abcde-fghij</code>) instead.</p>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="auth-primary" disabled={busy}>{busy ? "Verifying…" : "Sign in"}</button>
          <button type="button" className="auth-link" onClick={() => { setStep("password"); setError(""); }}>
            ← Use a different account
          </button>
        </form>
      )}
    </AuthCard>
  );
}
