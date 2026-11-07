import type { Metadata } from "next";
import { Footer, Header, PageHero } from "../components/SiteChrome";
import ProjectsBrowser from "./ProjectsBrowser";
import { getSiteContent } from "../../lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Projects",
  description: "Government, fintech, corporate, SaaS, e-commerce, management, and civic-tech products designed or developed by Maryama Ruun.",
  alternates: { canonical: "/projects" },
};

export default async function ProjectsPage() {
  const c = await getSiteContent();
  return (
    <main id="main-content">
      <Header />
      <PageHero
        kicker="Selected work"
        title="Projects built for"
        accent="real use."
        text="A complete collection of government, fintech, corporate, SaaS, e-commerce, management, and civic-tech products I have designed or developed."
      />
      <section className="section page-content">
        <div className="container">
          <ProjectsBrowser projects={c.projects} />
        </div>
      </section>
      <Footer email={c.settings.email} githubUrl={c.settings.github_url} linkedinUrl={c.settings.linkedin_url} />
    </main>
  );
}
