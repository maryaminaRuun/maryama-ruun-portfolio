import type { Metadata } from "next";
import { Footer, Header, PageHero } from "../components/SiteChrome";
import { getSiteContent } from "../../lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About",
  description: "Maryama Ruun — Software Engineer & Full-Stack Developer based in Mogadishu, Somalia. Experience, skills, and background.",
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const c = await getSiteContent();
  const s = c.settings;
  const bio = s.bio.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <main id="main-content">
      <Header />
      <PageHero kicker="About Maryama" title="I turn complex ideas into" accent="clear digital products." text={s.about_hero_text} />
      <section className="section page-content">
        <div className="container about-profile">
          <div className="about-photo">
            <img src="/maryama-ruun.png" alt={s.hero_name} width={640} height={800} />
          </div>
          <div className="about-copy">
            {bio.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <div className="mini-details">
              <div>
                <small>Location</small>
                <b>{s.location}</b>
              </div>
              <div>
                <small>Education</small>
                <b>{s.education}</b>
              </div>
              <div>
                <small>Focus</small>
                <b>{s.focus}</b>
              </div>
              <div>
                <small>Languages</small>
                <b>{s.languages}</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section muted-section">
        <div className="container">
          <p className="section-kicker">Experience</p>
          <h2 className="section-title compact">
            Experience that <span>ships.</span>
          </h2>
          <div className="timeline">
            {c.experience.map((e) => (
              <article key={e.role + e.period}>
                <div className="date">{e.period}</div>
                <div>
                  <h3>{e.role}</h3>
                  <p className="company">{e.company}</p>
                  <p>{e.desc}</p>
                </div>
                <span className="timeline-dot" />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <p className="section-kicker">Capabilities</p>
              <h2 className="section-title compact">
                The tools behind <span>the work.</span>
              </h2>
            </div>
            <p>Technology selected according to the problem, not the trend.</p>
          </div>
          <div className="skills-grid">
            {c.skills.map((g) => (
              <article key={g.title}>
                <span>{g.icon}</span>
                <h3>{g.title}</h3>
                <div>
                  {g.skills.map((sk) => (
                    <i key={sk}>{sk}</i>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {c.certificates.length ? (
        <section className="section muted-section">
          <div className="container">
            <p className="section-kicker">Certificates &amp; training</p>
            <h2 className="section-title compact">
              Always <span>learning.</span>
            </h2>
            <div className="highlight-grid">
              {c.certificates.map((h) => (
                <article key={h.title}>
                  <h3>{h.url ? <a href={h.url} target="_blank" rel="noopener noreferrer">{h.title}</a> : h.title}</h3>
                  {h.subtitle ? <small>{h.subtitle}</small> : null}
                  {h.desc ? <p>{h.desc}</p> : null}
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {c.testimonials.length ? (
        <section className="section">
          <div className="container">
            <p className="section-kicker">Testimonials</p>
            <h2 className="section-title compact">
              What people <span>say.</span>
            </h2>
            <div className="highlight-grid">
              {c.testimonials.map((h) => (
                <figure key={h.title}>
                  <blockquote>{h.desc}</blockquote>
                  <figcaption>
                    <b>{h.title}</b>
                    {h.subtitle ? <small>{h.subtitle}</small> : null}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      <Footer email={s.email} githubUrl={s.github_url} linkedinUrl={s.linkedin_url} />
    </main>
  );
}
