"use client";
import { FormEvent, useState } from "react";
import { AuthCard } from "./AuthCard";

type Start = { email: string; secret: string; uri: string; qrSvg: string };

export default function EnrollFlow({ mode, token, email }: { mode: "setup" | "invite"; token?: string; email?: string }) {
  const [step, setStep] = useState<"password" | "scan" | "done">("password");
  const [start, setStart] = useState<Start | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth/enroll/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, token, setupKey: f.get("setupKey"), password: f.get("password") }),
    });
    const data = (await r.json().catch(() => ({}))) as Start & { error?: string };
    setBusy(false);
    if (!r.ok) return setError(data.error || "Could not start setup.");
    setStart(data);
    setStep("scan");
  }

  async function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const r = await fetch("/api/auth/enroll/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: String(f.get("code") || "").trim() }) });
    const data = (await r.json().catch(() => ({}))) as { error?: string; recoveryCodes?: string[]; restart?: boolean };
    setBusy(false);
    if (!r.ok) {
      if (data.restart) setStep("password");
      return setError(data.error || "That code didn't work.");
    }
    setCodes(data.recoveryCodes ?? []);
    setStep("done");
  }

  const who = mode === "setup" ? "owner" : "editor";

  if (step === "done") {
    return (
      <AuthCard title="Save your recovery codes" subtitle="Each code signs you in once if you lose your phone. They are shown only now.">
        <ol className="recovery-codes" aria-label="Recovery codes">
          {codes.map((c) => (
            <li key={c}><code>{c}</code></li>
          ))}
        </ol>
        <button
          type="button"
          className="auth-link"
          onClick={() => navigator.clipboard?.writeText(codes.join("\n")).catch(() => {})}
        >
          Copy all codes
        </button>
        <label className="auth-check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved these codes somewhere safe (password manager or printed).
        </label>
        <a className={`auth-primary${saved ? "" : " disabled"}`} href={saved ? "/admin" : undefined} aria-disabled={!saved}>
          Open the dashboard →
        </a>
      </AuthCard>
    );
  }

  if (step === "scan" && start) {
    return (
      <AuthCard title="Connect your authenticator app" subtitle="Scan the code with Google Authenticator, Microsoft Authenticator, 1Password, Authy or similar.">
        <div className="qr-box" dangerouslySetInnerHTML={{ __html: start.qrSvg }} role="img" aria-label="QR code for your authenticator app" />
        <details className="auth-details">
          <summary>Can&apos;t scan? Enter the key manually</summary>
          <code className="secret-key">{start.secret.match(/.{1,4}/g)?.join(" ")}</code>
          <p className="auth-note">Account: {start.email} · Time-based · 6 digits</p>
        </details>
        <form className="auth-form" onSubmit={submitCode}>
          <label>
            Enter the 6-digit code the app shows
            <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required autoFocus maxLength={7} />
          </label>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="auth-primary" disabled={busy}>{busy ? "Verifying…" : "Confirm and finish"}</button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={mode === "setup" ? "Create the owner account" : "Join as an editor"}
      subtitle={mode === "setup" ? "You'll set a password, then connect an authenticator app. Two-step sign-in is required." : `You were invited as an editor${email ? ` (${email})` : ""}. Set a password, then connect an authenticator app.`}
    >
      <form className="auth-form" onSubmit={submitPassword}>
        {mode === "setup" ? (
          <label>
            Setup key
            <input name="setupKey" type="password" required autoComplete="off" />
            <small>The ADMIN_SETUP_KEY value you saved in Vercel.</small>
          </label>
        ) : null}
        <label>
          New password
          <input name="password" type="password" minLength={12} required autoComplete="new-password" />
          <small>At least 12 characters. A passphrase of several words works well.</small>
        </label>
        <label>
          Repeat password
          <input name="confirm" type="password" minLength={12} required autoComplete="new-password" />
        </label>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button className="auth-primary" disabled={busy}>{busy ? "Preparing…" : `Continue as ${who}`}</button>
      </form>
    </AuthCard>
  );
}
