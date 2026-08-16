/*
 * Mobile navigation as a bottom drawer (ModalOverlay + Modal give focus trap,
 * dismiss, and the slide hooks). The search input lives at the top; focusing it
 * (or typing) swaps the nav list below for live search results.
 */
import { useState } from "react";
import { Button, Dialog, DialogTrigger, Modal, ModalOverlay } from "react-aria-components";
import ThemeToggle from "./ThemeToggle.tsx";
import { useDocsSearch, SearchGlyph, highlight } from "./useDocsSearch.tsx";

const LINKS = [
  { title: "Docs", href: "/docs/" },
  { title: "Sharing", href: "/docs/sharing/" },
  { title: "Install", href: "/docs/install/" },
  { title: "GitHub", href: "https://github.com/mmurakaru/cueloop" },
];

function DrawerBody({ close }: { close: () => void }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const results = useDocsSearch(query);
  const searching = focused || query.trim().length > 0;

  return (
    <>
      <div className="drawer-grip" aria-hidden="true" />
      <div className="drawer-search-field">
        <SearchGlyph size={18} />
        <input
          type="text"
          className="drawer-search-input"
          placeholder="Search the docs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          aria-label="Search the docs"
        />
      </div>

      {searching ? (
        <ul className="drawer-results">
          {results.length === 0 && (
            <li className="search-empty">No matches for &ldquo;{query}&rdquo;</li>
          )}
          {results.map((hit) => (
            <li key={hit.doc.href}>
              <a href={hit.doc.href} className="drawer-result" onClick={close}>
                <span className="search-result__title">
                  {highlight(hit.doc.title, hit.titleRanges)}
                </span>
                <span className="search-result__meta">{hit.doc.group}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <nav className="drawer-nav">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="drawer-link" onClick={close}>
              {link.title}
            </a>
          ))}
        </nav>
      )}

      <div className="drawer-footer">
        <span className="drawer-footer__label">Theme</span>
        <ThemeToggle />
      </div>
    </>
  );
}

export default function MobileMenu() {
  return (
    <DialogTrigger>
      <Button className="menu-btn" aria-label="Open menu">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M3 6h14M3 10h14M3 14h14"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </Button>
      <ModalOverlay className="drawer-overlay" isDismissable>
        <Modal className="drawer">
          <Dialog className="drawer-dialog" aria-label="Navigation and search">
            {({ close }) => <DrawerBody close={close} />}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
