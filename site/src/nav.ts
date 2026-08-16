/*
 * The docs navigation model - one source of truth for the collapsible sidebar
 * and for cross-links. Each group renders as a React Aria Disclosure; the group
 * holding the current page starts expanded.
 */

export interface NavItem {
  title: string;
  href: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const docsNav: NavGroup[] = [
  {
    title: "Start here",
    items: [
      { title: "Overview", href: "/docs/" },
      { title: "Install & quickstart", href: "/docs/install/" },
    ],
  },
  {
    title: "Concepts",
    items: [
      { title: "The review session", href: "/docs/concepts/review-session/" },
      { title: "Annotations", href: "/docs/concepts/annotations/" },
      { title: "Plan, diff, review", href: "/docs/concepts/plan-diff-review/" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "Commands", href: "/docs/reference/commands/" },
      { title: "Configuration", href: "/docs/reference/configuration/" },
    ],
  },
  {
    title: "Sharing over SSH",
    items: [
      { title: "Overview", href: "/docs/sharing/" },
      { title: "Share a plan", href: "/docs/sharing/quickstart/" },
      { title: "How the loop works", href: "/docs/sharing/how-it-works/" },
      { title: "Identity & attribution", href: "/docs/sharing/identity/" },
      { title: "Security & privacy", href: "/docs/sharing/security/" },
    ],
  },
  {
    title: "Agents",
    items: [{ title: "Agent integration", href: "/docs/agents/" }],
  },
];

/** Normalise a pathname so trailing-slash differences never break matching. */
export function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}
