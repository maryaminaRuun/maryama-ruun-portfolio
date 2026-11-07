"use client";
import { useMemo, useState } from "react";
import ProjectCard from "../components/ProjectCard";
import type { Project } from "../../lib/content";

/** Category filter for the full projects page. Categories come from each project's tag. */
function categoryOf(tag: string) {
  return tag.split("·")[0]!.trim();
}

export default function ProjectsBrowser({ projects }: { projects: Project[] }) {
  const categories = useMemo(() => ["All", ...Array.from(new Set(projects.map((p) => categoryOf(p.tag))))], [projects]);
  const [active, setActive] = useState("All");
  const shown = active === "All" ? projects : projects.filter((p) => categoryOf(p.tag) === active);
  return (
    <>
      {categories.length > 2 ? (
        <div className="project-filters" role="group" aria-label="Filter projects by category">
          {categories.map((cat) => (
            <button key={cat} type="button" className={cat === active ? "active" : ""} aria-pressed={cat === active} onClick={() => setActive(cat)}>
              {cat}
            </button>
          ))}
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        Showing {shown.length} of {projects.length} projects
      </p>
      <div className="project-grid">
        {shown.map((p, i) => (
          <ProjectCard key={`${p.id ?? p.title}`} project={p} index={projects.indexOf(p) >= 0 ? projects.indexOf(p) : i} />
        ))}
      </div>
    </>
  );
}
