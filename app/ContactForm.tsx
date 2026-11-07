"use client";
import { FormEvent, useState } from "react";

type State = { kind: "idle" | "sending" | "ok" | "error"; text: string };

export default function ContactForm() {
  const [state, setState] = useState<State>({ kind: "idle", text: "" });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setState({ kind: "sending", text: "Sending…" });
    try {
      const body = Object.fromEntries(new FormData(form));
      const r = await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.ok) {
        setState({ kind: "ok", text: "Message sent successfully. I'll get back to you soon." });
        form.reset();
      } else {
        setState({ kind: "error", text: data.error || "Please check the form and try again." });
      }
    } catch {
      setState({ kind: "error", text: "Network error. Please try again, or email me directly." });
    }
  }

  return (
    <form className="contact-form" onSubmit={submit} noValidate={false}>
      <div>
        <label className="sr-only" htmlFor="cf-name">Your name</label>
        <input id="cf-name" name="name" placeholder="Your name" autoComplete="name" maxLength={120} required />
        <label className="sr-only" htmlFor="cf-email">Email address</label>
        <input id="cf-email" name="email" type="email" placeholder="Email address" autoComplete="email" maxLength={200} required />
      </div>
      <label className="sr-only" htmlFor="cf-subject">Project subject</label>
      <input id="cf-subject" name="subject" placeholder="Project subject" maxLength={200} required />
      <label className="sr-only" htmlFor="cf-message">Message</label>
      <textarea id="cf-message" name="message" placeholder="Tell me about your project" rows={5} maxLength={5000} required />
      {/* Honeypot: hidden from people, bots tend to fill it in. */}
      <div className="hp-field" aria-hidden="true">
        <label htmlFor="cf-website">Website</label>
        <input id="cf-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <button className="button white" type="submit" disabled={state.kind === "sending"}>
        {state.kind === "sending" ? "Sending…" : "Send message ↗"}
      </button>
      <p aria-live="polite" role={state.kind === "error" ? "alert" : undefined}>
        {state.kind === "sending" ? "" : state.text}
      </p>
    </form>
  );
}
