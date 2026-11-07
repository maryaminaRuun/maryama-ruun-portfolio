import { Footer, Header } from "./components/SiteChrome";

export default function NotFound() {
  return (
    <main id="main-content">
      <Header />
      <section className="page-hero">
        <div className="orb orb-one" />
        <div className="container">
          <p className="section-kicker">404</p>
          <h1>
            This page could not be <span>found.</span>
          </h1>
          <p>The link may be outdated or mistyped. Try the homepage or browse the projects.</p>
          <div className="hero-actions">
            <a className="button primary" href="/">
              Back to home
            </a>
            <a className="button secondary" href="/projects">
              View projects
            </a>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
