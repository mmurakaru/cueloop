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
    title: "Get started",
    items: [
      { title: "Overview", href: "/docs/" },
      { title: "Install and quickstart", href: "/docs/install/" },
    ],
  },
  {
    title: "Use cueloop",
    items: [
      { title: "Review agent work", href: "/docs/concepts/plan-diff-review/" },
      { title: "Review diffs", href: "/docs/concepts/diffs/" },
      { title: "Share a Thread", href: "/docs/sharing/" },
      { title: "Connect coding agents", href: "/docs/agents/" },
    ],
  },
  {
    title: "Understand cueloop",
    items: [
      { title: "Threads", href: "/docs/concepts/thread/" },
      { title: "Comments", href: "/docs/concepts/comments/" },
      { title: "History", href: "/docs/concepts/history/" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "Commands", href: "/docs/reference/commands/" },
      { title: "Configuration", href: "/docs/reference/configuration/" },
      { title: "VCS extensions", href: "/docs/reference/vcs-extensions/" },
      { title: "Keyboard and mouse", href: "/docs/reference/keyboard/" },
      { title: "Public API", href: "/docs/reference/api/" },
      { title: "Security and privacy", href: "/docs/sharing/security/" },
      { title: "Performance", href: "/docs/reference/performance/" },
    ],
  },
];

/** Normalise a pathname so trailing-slash differences never break matching. */
export function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);

  return path;
}
