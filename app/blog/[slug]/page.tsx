import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Footer, Header } from "../../components/SiteChrome";
import { getSiteContent } from "../../../lib/content";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = (await getSiteContent()).posts.find((p) => p.slug === slug);
  if (!post) return { title: "Article not found" };
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: "article", title: post.title, description: post.excerpt, images: post.image ? [post.image] : undefined },
  };
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const c = await getSiteContent();
  const post = c.posts.find((p) => p.slug === slug);
  if (!post) notFound();
  return (
    <main id="main-content">
      <Header />
      <article className="article-page">
        <header>
          <div className="container article-head">
            <a href="/blog">← Back to blog</a>
            <p className="section-kicker">{post.category}</p>
            <h1>{post.title}</h1>
            <div>
              <span>{post.date}</span>
              <span>{post.read}</span>
            </div>
          </div>
        </header>
        <div className="container article-body">
          {post.image ? <img className="article-cover" src={post.image} alt="" /> : null}
          {post.content.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <aside>
            <b>Have a related project?</b>
            <p>I can help turn the idea into a clear, working digital product.</p>
            <a className="button primary" href="/contact">
              Let&apos;s talk →
            </a>
          </aside>
        </div>
      </article>
      <Footer email={c.settings.email} githubUrl={c.settings.github_url} linkedinUrl={c.settings.linkedin_url} />
    </main>
  );
}
