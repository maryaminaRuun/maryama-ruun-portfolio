import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="brand admin-brand auth-brand" href="/">
          <span>MR</span>
          <div>
            Maryama Ruun<small>Portfolio Admin</small>
          </div>
        </a>
        <h1 id="auth-title">{title}</h1>
        {subtitle ? <p className="auth-sub">{subtitle}</p> : null}
        {children}
      </section>
    </main>
  );
}
