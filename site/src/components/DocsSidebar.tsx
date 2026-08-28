/*
 * The docs sidebar: grouped links - a section label per
 * group, items below, the current page highlighted. Static (no client JS); the
 * current path drives the active state at build time.
 */
import { docsNav, normalizePath } from "../nav";

interface DocsSidebarProps {
  /** The current pathname, so the active link highlights. */
  path: string;
}

export default function DocsSidebar({ path }: DocsSidebarProps) {
  const current = normalizePath(path);

  return (
    <nav className="docs-sidebar" aria-label="Documentation">
      {docsNav.map((group) => (
        <div key={group.title} className="docs-group">
          <p className="docs-group__label">{group.title}</p>
          <ul className="docs-group__list">
            {group.items.map((item) => {
              const isCurrent = normalizePath(item.href) === current;

              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className={`docs-link${isCurrent ? " is-active" : ""}`}
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    {item.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
