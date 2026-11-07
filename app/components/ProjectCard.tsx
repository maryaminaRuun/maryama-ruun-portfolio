import type { Project } from "../../lib/content";

type CardProject = Pick<Project, "title" | "tag" | "desc" | "url" | "label" | "image" | "tone" | "mark">;

export default function ProjectCard({ project: p, index }: { project: CardProject; index: number }) {
  const external = /^https?:\/\//.test(p.url);
  const linkProps = external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <article className="project-card">
      <a className="project-shot" href={p.url} {...linkProps} aria-label={`Open ${p.title} project${external ? " (opens in a new tab)" : ""}`}>
        <div className={`project-cover ${p.tone} ${p.image ? "has-screen" : ""}`}>
          <span className="project-index">{String(index + 1).padStart(2, "0")}</span>
          {p.image ? (
            <>
              <div className="browser-bar" aria-hidden="true">
                <i />
                <i />
                <i />
                <small>{p.label}</small>
              </div>
              <img src={p.image} alt={`${p.title} website homepage screenshot`} loading={index > 1 ? "lazy" : "eager"} decoding="async" width={1200} height={750} />
            </>
          ) : (
            <>
              <strong>{p.mark}</strong>
              <i />
            </>
          )}
        </div>
      </a>
      <div className="project-body">
        <p className="tag">{p.tag}</p>
        <h3>{p.title}</h3>
        <p>{p.desc}</p>
        <a href={p.url} {...linkProps}>
          {p.label} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}
