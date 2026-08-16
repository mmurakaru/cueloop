/*
 * Shared docs search: loads the build-time index once (module-cached across both
 * the header and mobile-drawer islands) and returns Fuse.js matches for a query.
 * Empty query returns the first few docs as a default list.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SearchDoc } from "../search-data";

/** A result plus the char ranges of the title that matched the query. */
export interface SearchHit {
  doc: SearchDoc;
  titleRanges: readonly [number, number][];
}

let indexCache: SearchDoc[] | null = null;

export function useDocsSearch(query: string, limit = 8): SearchHit[] {
  const [docs, setDocs] = useState<SearchDoc[]>(indexCache ?? []);

  useEffect(() => {
    if (indexCache) return;
    fetch("/search-index.json")
      .then((response) => response.json())
      .then((data: SearchDoc[]) => {
        indexCache = data;
        setDocs(data);
      })
      .catch(() => {
        // index unavailable; results stay empty
      });
  }, []);

  return useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return docs.slice(0, 6).map((doc) => ({ doc, titleRanges: [] }));
    }
    // Deterministic substring match: title matches first (with the matched
    // range bolded), then pages whose headings contain the query.
    const titleHits: SearchHit[] = [];
    const headingHits: SearchHit[] = [];
    for (const doc of docs) {
      const at = doc.title.toLowerCase().indexOf(needle);
      if (at >= 0) {
        titleHits.push({ doc, titleRanges: [[at, at + needle.length - 1]] });
      } else if ((doc.headings ?? []).some((heading) => heading.toLowerCase().includes(needle))) {
        headingHits.push({ doc, titleRanges: [] });
      }
    }
    return [...titleHits, ...headingHits].slice(0, limit);
  }, [query, docs, limit]);
}

/** Render text with the given char ranges bolded (Fuse indices are inclusive). */
export function highlight(text: string, ranges: readonly [number, number][]): ReactNode {
  if (!ranges.length) return text;
  const ordered = [...ranges].sort((a, b) => a[0] - b[0]);
  const parts: ReactNode[] = [];
  let cursor = 0;
  ordered.forEach(([start, end], index) => {
    if (start < cursor) return;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<strong key={index}>{text.slice(start, end + 1)}</strong>);
    cursor = end + 1;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function SearchGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
