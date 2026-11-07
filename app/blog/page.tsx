import type { Metadata } from "next";
import { Footer, Header, PageHero } from "../components/SiteChrome";
import { getSiteContent } from "../../lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog",
  description: "Writing about full-stack development, product design, dashboards, responsible AI, and reliable digital products.",
  alternates: { canonical: "/blog" },
};

export default async function BlogPage() {
  const c = await getSiteContent();
  // Featured post first, as on the live site.
  const posts = [...c.posts.filter((p) => p.featured), ...c.posts.filter((p) => !p.featured)];
  return (
    <main id="main-content">
      <Header />
      <PageHero
        kicker="Blog"
        title="Ideas, lessons, and"
        accent="practical engineering."
        text="Writing about full-stack development, product design, dashboards, responsible AI, and the decisions behind reliable digital products."
      />
      <section className="section page-content">
        <div className="container blog-grid blog-grid-full">
          {posts.map((p) => (
            <a className={`blog-card${p.featured ? " featured-post" : ""}`} href={`/blog/${p.slug}`} key={p.slug}>
              {p.featured ? <em className="featured-badge">Featured</em> : null}
              <div>
                <span>{p.category}</span>
                <small>
                  {p.date} · {p.read}
                </small>
              </div>
              <h2>{p.title}</h2>
              <p>{p.excerpt}</p>
              <b>Read article →</b>
            </a>
          ))}
        </div>
      </section>
      <Footer email={c.settings.email} githubUrl={c.settings.github_url} linkedinUrl={c.settings.linkedin_url} />
    </main>
  );
}
