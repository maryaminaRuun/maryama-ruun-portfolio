import type { Metadata } from "next";
import ContactForm from "../ContactForm";
import { Footer, Header, PageHero } from "../components/SiteChrome";
import { getSiteContent } from "../../lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact",
  description: "Start a conversation with Maryama Ruun about your website, platform, dashboard, or product.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const c = await getSiteContent();
  const s = c.settings;
  return (
    <main id="main-content">
      <Header />
      <PageHero kicker="Contact" title="Tell me what you want to" accent="build next." text={s.contact_intro} />
      <section className="section page-content">
        <div className="container contact-page-grid">
          <div>
            <p className="section-kicker">Start a conversation</p>
            <h2>Let&apos;s make the scope clear before we write code.</h2>
            <p>
              Good projects start with the problem, the users, and the outcome—not a long feature list. Send the essential context and I&apos;ll help
              structure the next step.
            </p>
            <div className="direct-contact">
              <a href={`mailto:${s.email}`}>
                <small>Email</small>
                <b>{s.email}</b>
              </a>
              <div>
                <small>Location</small>
                <b>
                  {s.location} · {s.timezone}
                </b>
              </div>
            </div>
          </div>
          <div className="contact-panel">
            <ContactForm />
          </div>
        </div>
      </section>
      <Footer email={s.email} githubUrl={s.github_url} linkedinUrl={s.linkedin_url} />
    </main>
  );
}
