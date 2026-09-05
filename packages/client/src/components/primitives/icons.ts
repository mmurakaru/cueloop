// Nerd Font glyphs (Private Use Area / codicons) plus the plus-minus diff mark; render as icons under a Nerd Font, tofu without one.

export const NERD = {
  folderClosed: "",
  folderOpen: "",
  file: "",
  chevronRight: "",
  chevronDown: "",
  settings: "",
  search: "",
  expand: "",
  diff: "±",
  listTree: "",
  sidebarLeft: "",
  sidebarLeftOff: "",
  sidebarRight: "",
  sidebarRightOff: "",
  submit: "",
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
