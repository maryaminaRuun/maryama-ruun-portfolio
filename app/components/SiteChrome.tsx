"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Home"],
  ["/about", "About"],
  ["/projects", "Projects"],
  ["/services", "Services"],
  ["/blog", "Blog"],
  ["/contact", "Contact"],
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("maryama-theme");
    } catch {}
    const next = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("maryama-theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <header className="nav-wrap">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <nav className="container nav" aria-label="Main navigation">
        <a className="brand" href="/" aria-label="Maryama Ruun home">
          <span>MR</span> Maryama Ruun
        </a>
        <button className="mobile-toggle" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="site-nav-links">
          {open ? "×" : "☰"}
        </button>
        <div id="site-nav-links" className={`nav-links ${open ? "open" : ""}`}>
          {links.map(([href, label]) => {
            const active = isActive(pathname, href);
            return (
              <a key={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} href={href} onClick={() => setOpen(false)}>
                {label}
              </a>
            );
          })}
          <button className="theme-toggle" onClick={toggleTheme} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
            {dark ? "☀" : "☾"}
          </button>
        </div>
      </nav>
    </header>
  );
}

export function Footer({ email, githubUrl, linkedinUrl }: { email?: string; githubUrl?: string; linkedinUrl?: string } = {}) {
  return (
    <footer>
      <div className="container footer-inner">
        <a className="brand" href="/">
          <span>MR</span> Maryama Ruun
        </a>
        <p>Software Engineer · Full-Stack Developer</p>
        <p className="footer-links">
          {githubUrl ? (
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          ) : null}
          {linkedinUrl ? (
            <a href={linkedinUrl} target="_blank" rel="noopener noreferrer">
              LinkedIn
            </a>
          ) : null}
          {email ? <a href={`mailto:${email}`}>Email</a> : null}
        </p>
        <p>© {new Date().getFullYear()} Maryama Ruun</p>
      </div>
    </footer>
  );
}

export function PageHero({ kicker, title, accent, text }: { kicker: string; title: string; accent: string; text: string }) {
  return (
    <section className="page-hero">
      <div className="orb orb-one" />
      <div className="container">
        <p className="section-kicker">{kicker}</p>
        <h1>
          {title} <span>{accent}</span>
        </h1>
        <p>{text}</p>
      </div>
    </section>
  );
}
