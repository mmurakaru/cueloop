/*
 * Docs search: a command-palette modal over the build-time index, fuzzed with
 * Fuse.js. Opens from the header trigger, the Cmd/Ctrl+K shortcut, or a
 * `cueloop:open-search` event (dispatched by the mobile drawer). React Aria
 * ModalOverlay handles focus trap + dismiss; result navigation is keyboard
 * driven (up/down/enter).
 */
import { useEffect, useMemo, useState } from "react";
import { ModalOverlay, Modal, Dialog, Button } from "react-aria-components";
import Fuse from "fuse.js";
import type { SearchDoc } from "../search-data";

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export default function DocsSearch() {
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<SearchDoc[]>([]);

  useEffect(() => {
    fetch("/search-index.json")
      .then((response) => response.json())
      .then((data: SearchDoc[]) => setDocs(data))
      .catch(() => {
        // search index unavailable; the palette just shows no results
      });
  }, []);

  const fuse = useMemo(
    () =>
      new Fuse(docs, {
        keys: [
          { name: "title", weight: 0.5 },
          { name: "headings", weight: 0.25 },
          { name: "description", weight: 0.2 },
          { name: "group", weight: 0.1 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [docs],
  );

  const results = useMemo<SearchDoc[]>(() => {
    if (!query.trim()) return docs.slice(0, 6);
    return fuse.search(query).slice(0, 8).map((hit) => hit.item);
  }, [query, fuse, docs]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("cueloop:open-search", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cueloop:open-search", onOpenEvent);
    };
  }, []);

  function navigate(doc: SearchDoc | undefined) {
    if (doc) window.location.href = doc.href;
  }

  function onInputKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      navigate(results[active]);
    }
  }

  return (
    <>
      <Button className="search-trigger" onPress={() => setOpen(true)} aria-label="Search docs">
        <SearchIcon />
        <span className="search-trigger__label">Search</span>
        <kbd className="search-trigger__kbd">&#8984;K</kbd>
      </Button>
      <ModalOverlay className="search-overlay" isOpen={isOpen} onOpenChange={setOpen} isDismissable>
        <Modal className="search-modal">
          <Dialog className="search-dialog" aria-label="Search the docs">
            <div className="search-field">
              <SearchIcon size={18} />
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <input
                autoFocus
                type="text"
                className="search-input"
                placeholder="Search the docs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKey}
                role="combobox"
                aria-expanded="true"
                aria-controls="search-results"
                aria-label="Search the docs"
              />
              <kbd className="search-esc">esc</kbd>
            </div>
            <ul id="search-results" className="search-results" role="listbox">
              {results.length === 0 && (
                <li className="search-empty">No matches for &ldquo;{query}&rdquo;</li>
              )}
              {results.map((doc, index) => (
                <li key={doc.href} role="option" aria-selected={index === active}>
                  <a
                    href={doc.href}
                    className={`search-result${index === active ? " is-active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                  >
                    <span className="search-result__group">{doc.group}</span>
                    <span className="search-result__title">{doc.title}</span>
                    {doc.description && (
                      <span className="search-result__desc">{doc.description}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}
