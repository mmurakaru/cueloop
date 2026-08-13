/*
 * Build-time search index over the docs. Globs every docs MDX page, pulls its
 * frontmatter (title, lede) and headings, and tags it with the nav group it
 * belongs to. The client-side Fuse.js search (DocsSearch) fuzzes over this.
 */
import { docsNav, normalizePath } from "./nav";

export interface SearchDoc {
  title: string;
  description: string;
  href: string;
  group: string;
  headings: string[];
}

interface MdxModule {
  frontmatter?: { title?: string; lede?: string; description?: string };
  url?: string;
  getHeadings?: () => Array<{ depth: number; slug: string; text: string }>;
}

const modules = import.meta.glob<MdxModule>("./pages/docs/**/*.mdx", { eager: true });

function groupFor(href: string): string {
  const target = normalizePath(href);
  for (const group of docsNav) {
    if (group.items.some((item) => normalizePath(item.href) === target)) return group.title;
  }
  return "Docs";
}

export const searchDocs: SearchDoc[] = Object.values(modules)
  .map((mod): SearchDoc | null => {
    const frontmatter = mod.frontmatter ?? {};
    const rawUrl = mod.url ?? "";
    if (!frontmatter.title || !rawUrl) return null;
    const href = rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`;
    const headings = (mod.getHeadings?.() ?? [])
      .filter((heading) => heading.depth >= 2 && heading.depth <= 3)
      .map((heading) => heading.text);
    return {
      title: frontmatter.title,
      description: frontmatter.lede ?? frontmatter.description ?? "",
      href,
      group: groupFor(href),
      headings,
    };
  })
  .filter((doc): doc is SearchDoc => doc !== null)
  .sort((a, b) => a.href.localeCompare(b.href));
