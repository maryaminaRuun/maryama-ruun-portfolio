import type { Metadata } from "next";
import { Footer, Header, PageHero } from "../components/SiteChrome";
import { getSiteContent } from "../../lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Services",
  description: "Full-stack development, business websites, SaaS dashboards, and UI/UX design by Maryama Ruun.",
  alternates: { canonical: "/services" },
};

export default async function ServicesPage() {
  const c = await getSiteContent();
  return (
    <main id="main-content">
      <Header />
      <PageHero
        kicker="Services"
        title="Digital products designed to"
        accent="work and grow."
        text="Focused engineering and design support for organizations that need a dependable website, platform, dashboard, or product experience."
      />
      <section className="section page-content">
        <div className="container services-detail">
          {c.services.map((s) => (
            <article key={s.number + s.title}>
              <div className="service-number">{s.number}</div>
              <div>
                <h2>{s.title}</h2>
                <p>{s.desc}</p>
              </div>
              <ul>
                {s.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section className="section contact">
        <div className="container contact-card compact-cta">
          <div>
            <p className="section-kicker light">Need one of these services?</p>
            <h2>
              Let&apos;s define the right <span>solution.</span>
            </h2>
          </div>
          <div className="contact-actions">
            <a className="button white" href="/contact">
              Discuss your project →
            </a>
          </div>
        </div>
      </section>
      <Footer email={c.settings.email} githubUrl={c.settings.github_url} linkedinUrl={c.settings.linkedin_url} />
    </main>
  );
}
