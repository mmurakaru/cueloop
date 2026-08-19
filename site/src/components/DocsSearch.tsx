/*
 * Header docs search (desktop). A search icon that expands into an inline input;
 * results render in a popover anchored below the input - no centered overlay.
 * Cmd/Ctrl+K expands and focuses it. Collapses on Escape, outside click, or
 * after picking a result.
 */
import { useEffect, useRef, useState } from "react";
import { useDocsSearch, SearchGlyph, highlight } from "./useDocsSearch.tsx";

export default function DocsSearch() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useDocsSearch(query);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function open() {
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function close() {
    setExpanded(false);
    setQuery("");
    setActive(0);
  }

  // oxlint-disable-next-line react/set-state-in-effect -- reset highlight when the query changes; deriving in render is not worth the churn
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    function onPointerDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) close();
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [expanded]);

  function navigate(href: string | undefined) {
    if (href) window.location.href = href;
  }

  function onInputKey(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      navigate(results[active]?.doc.href);
    }
  }

  return (
    <div className={`search-box${expanded ? " is-expanded" : ""}`} ref={boxRef}>
      <button
        type="button"
        className="search-box__icon"
        aria-label="Search docs"
        aria-expanded={expanded}
        onClick={() => (expanded ? inputRef.current?.focus() : open())}
      >
        <SearchGlyph size={17} />
      </button>
      <input
        ref={inputRef}
        type="text"
        className="search-box__input"
        placeholder="Search the docs"
        value={query}
        tabIndex={expanded ? 0 : -1}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onInputKey}
        role="combobox"
        aria-expanded={expanded}
        aria-controls="search-pop-list"
        aria-label="Search the docs"
      />
      {expanded && (
        <div className="search-pop">
          <ul id="search-pop-list" className="search-results" role="listbox">
            {results.length === 0 && (
              <li className="search-empty">No matches for &ldquo;{query}&rdquo;</li>
            )}
            {results.map((hit, index) => (
              <li key={hit.doc.href} role="option" aria-selected={index === active}>
                <a
                  href={hit.doc.href}
                  className={`search-result${index === active ? " is-active" : ""}`}
                  onMouseEnter={() => setActive(index)}
                >
                  <span className="search-result__title">
                    {highlight(hit.doc.title, hit.titleRanges)}
                  </span>
                  <span className="search-result__meta">{hit.doc.group}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
