/*
 * The docs sidebar: grouped links where each group is a React Aria Disclosure
 * (accessible expand/collapse, keyboard + ARIA handled). The group containing
 * the current page starts open; the active link is marked aria-current.
 */
import { Disclosure, DisclosurePanel, Button } from "react-aria-components";
import { docsNav, normalizePath, type NavGroup } from "../nav";

interface DocsSidebarProps {
  /** The current pathname, so the active group opens and the link highlights. */
  path: string;
}

function groupHasCurrent(group: NavGroup, current: string): boolean {
  return group.items.some((item) => normalizePath(item.href) === current);
}

export default function DocsSidebar({ path }: DocsSidebarProps) {
  const current = normalizePath(path);
  return (
    <nav className="docs-sidebar" aria-label="Documentation">
      {docsNav.map((group) => {
        const open = groupHasCurrent(group, current);
        return (
          <Disclosure
            key={group.title}
            className="docs-group"
            defaultExpanded={open}
          >
            <h2 className="docs-group__heading">
              <Button slot="trigger" className="docs-group__trigger">
                <svg
                  className="docs-group__chevron"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  aria-hidden="true"
                >
                  <path
                    d="M3 1.5 L6.5 5 L3 8.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {group.title}
              </Button>
            </h2>
            <DisclosurePanel className="docs-group__panel">
              <ul>
                {group.items.map((item) => {
                  const isCurrent = normalizePath(item.href) === current;
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className="docs-link"
                        aria-current={isCurrent ? "page" : undefined}
                      >
                        {item.title}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </DisclosurePanel>
          </Disclosure>
        );
      })}
    </nav>
  );
}
