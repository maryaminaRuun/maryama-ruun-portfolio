import type { Metadata } from "next";
import { Footer, Header } from "./components/SiteChrome";
import ProjectCard from "./components/ProjectCard";
import { getSiteContent, selectHomepageProjects } from "../lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

function paragraphs(text: string) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export default async function Home() {
  const c = await getSiteContent();
  const s = c.settings;
  const featured = selectHomepageProjects(c.projects);
  const [firstName, ...rest] = s.hero_name.split(" ");
  const personLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: s.hero_name,
    jobTitle: s.hero_role,
    email: `mailto:${s.email}`,
    url: s.site_url,
    image: `${s.site_url}/maryama-ruun.png`,
    address: { "@type": "PostalAddress", addressLocality: s.location },
    sameAs: [s.github_url, s.linkedin_url].filter(Boolean),
  };

  return (
    <main id="main-content">
      <Header />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd).replace(/</g, "\\u003c") }} />
      <section className="hero section">
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="container hero-grid">
          <div className="hero-copy reveal">
            <div className="eyebrow">
              <i /> {s.hero_eyebrow}
            </div>
            <p className="hello">Hello, I&apos;m</p>
            <h1>
              {firstName} <span>{rest.join(" ")}.</span>
            </h1>
            <h2>{s.hero_role}</h2>
            <p className="lead">{s.hero_lead}</p>
            <div className="hero-actions">
              <a className="button primary" href="/projects">
                Explore my work <span aria-hidden="true">↗</span>
              </a>
              <a className="button secondary" href="/contact">
                Let&apos;s work together
              </a>
            </div>
            <div className="social-row">
              {s.github_url ? (
                <a href={s.github_url} target="_blank" rel="noopener noreferrer">
                  GitHub ↗
                </a>
              ) : null}
              {s.linkedin_url ? (
                <a href={s.linkedin_url} target="_blank" rel="noopener noreferrer">
                  LinkedIn ↗
                </a>
              ) : null}
              <a href={`mailto:${s.email}`}>Email ↗</a>
            </div>
          </div>
          <div className="hero-visual">
            <div className="visual-grid" />
            <div className="portrait-card photo-card">
              <img src="/maryama-ruun.png" alt={`${s.hero_name}, ${s.hero_role}`} width={640} height={800} fetchPriority="high" />
              <span className="portrait-role">ENGINEER · DESIGNER</span>
            </div>
            <div className="floating-card code-card" aria-hidden="true">
              <b>&lt;/&gt;</b>
              <span>Building for impact</span>
            </div>
            <div className="floating-card location-card">
              <b aria-hidden="true">⌖</b>
              <span>{s.location}</span>
            </div>
          </div>
        </div>
        <div className="container metrics">
          <div>
            <strong>{s.years_experience}</strong>
            <span>
              Years professional
              <br />
              experience
            </span>
          </div>
          <div>
            <strong>{s.products_delivered}</strong>
            <span>
              Products &amp; websites
              <br />
              delivered
            </span>
          </div>
          <div>
            <strong>{c.projects.length}</strong>
            <span>
              Portfolio
              <br />
              projects
            </span>
          </div>
          <div>
            <strong>100%</strong>
            <span>
              Focus on quality
              <br />
              and usability
            </span>
          </div>
        </div>
      </section>

      <section className="section home-intro">
        <div className="container two-col">
          <div>
            <p className="section-kicker">What I do</p>
            <h2 className="section-title">
              Engineering with <span>clarity and purpose.</span>
            </h2>
          </div>
          <div className="about-copy">
            {paragraphs(s.bio).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <a className="text-link" href="/about">
              More about me ↗
            </a>
          </div>
        </div>
      </section>

      <section className="section muted-section">
        <div className="container">
          <div className="section-head">
            <div>
              <p className="section-kicker">Production work</p>
              <h2 className="section-title compact">
                Live projects built for <span>real use.</span>
              </h2>
            </div>
            <p>{s.featured_intro}</p>
          </div>
          <div className="project-grid featured-grid">
            {featured.map((p, i) => (
              <ProjectCard key={`${p.id ?? p.title}`} project={p} index={i} />
            ))}
          </div>
          <div className="center-action">
            <a className="button primary" href="/projects">
              View all projects <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <p className="section-kicker">Services</p>
              <h2 className="section-title compact">
                From idea to <span>working product.</span>
              </h2>
            </div>
            <a className="text-link" href="/services">
              View all services ↗
            </a>
          </div>
          <div className="service-preview">
            {c.services.slice(0, 4).map((sv) => (
              <article key={sv.number + sv.title}>
                <span>{sv.number}</span>
                <h3>{sv.title}</h3>
                <p>{sv.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section muted-section">
        <div className="container">
          <div className="section-head">
            <div>
              <p className="section-kicker">Latest writing</p>
              <h2 className="section-title compact">
                Notes on building <span>better products.</span>
              </h2>
            </div>
            <a className="text-link" href="/blog">
              View all posts ↗
            </a>
          </div>
          <div className="blog-grid">
            {c.posts.slice(0, 3).map((p) => (
              <a className="blog-card" href={`/blog/${p.slug}`} key={p.slug}>
                <div>
                  <span>{p.category}</span>
                  <small>{p.date}</small>
                </div>
                <h3>{p.title}</h3>
                <p>{p.excerpt}</p>
                <b>Read article →</b>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="section contact">
        <div className="container contact-card compact-cta">
          <div>
            <p className="section-kicker light">Let&apos;s connect</p>
            <h2>
              Have a project in mind?
              <br />
              <span>Let&apos;s make it real.</span>
            </h2>
            <p>{s.contact_intro}</p>
          </div>
          <div className="contact-actions">
            <a className="button white" href="/contact">
              Start a conversation <span aria-hidden="true">→</span>
            </a>
            <a href={`mailto:${s.email}`}>{s.email}</a>
          </div>
        </div>
      </section>
      <Footer email={s.email} githubUrl={s.github_url} linkedinUrl={s.linkedin_url} />
    </main>
  );
}
