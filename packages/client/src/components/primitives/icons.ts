// Nerd Font glyphs (Unicode Private Use Area); render as icons under a Nerd Font, tofu without one.

export const NERD = {
  folderClosed: "",
  folderOpen: "",
  file: "",
  chevronRight: "",
  chevronDown: "",
  search: "",
  settings: "",
  expand: "",
  split: "",
  history: "",
  sidebar: "",
} as const;

export interface TreeIcons {
  collapsed: string;
  expanded: string;
  leaf: string;
}

export const NERD_TREE_ICONS: TreeIcons = {
  collapsed: NERD.folderClosed,
  expanded: NERD.folderOpen,
  leaf: NERD.file,
};

// Fallback for terminals without a Nerd Font.
export const ASCII_TREE_ICONS: TreeIcons = {
  collapsed: "▸",
  expanded: "▾",
  leaf: " ",
};
