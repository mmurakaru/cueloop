/*
 * The right-rail "On this page" table of contents. Highlights the heading the
 * reader is currently on via an IntersectionObserver scroll-spy.
 */
import { useEffect, useState } from "react";

export interface Heading {
  depth: number;
  slug: string;
  text: string;
}

export default function DocsToc({ headings }: { headings: Heading[] }) {
  const [activeSlug, setActiveSlug] = useState<string>(headings[0]?.slug ?? "");

  useEffect(() => {
    const elements = headings
      .map((heading) => document.getElementById(heading.slug))
      .filter((element): element is HTMLElement => element !== null);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSlug(visible[0].target.id);
      },
      { rootMargin: "-84px 0px -68% 0px", threshold: 0 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [headings]);

  return (
    <nav className="toc" aria-label="On this page">
      <p className="toc__title">On this page</p>
      <ul>
        {headings.map((heading) => (
          <li key={heading.slug} className={`toc__item toc__item--d${heading.depth}`}>
            <a
              href={`#${heading.slug}`}
              className={`toc__link${activeSlug === heading.slug ? " is-active" : ""}`}
              aria-current={activeSlug === heading.slug ? "location" : undefined}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
