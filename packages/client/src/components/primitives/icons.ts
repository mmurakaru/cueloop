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
  kebab: "⋮",
  pin: "⚑",
  close: "✕",
  listTree: "",
  sidebarLeft: "",
  sidebarLeftOff: "",
  sidebarRight: "",
  sidebarRightOff: "",
  submit: "",
  zoom: "⛶",
  split: "",
} as const;

// The thin rule under each pane header: an overline sits at the top edge of its cell so it hugs the
// header text (unlike the default light-horizontal, which floats mid-cell); painted in divider gray upstream.
export const HEADER_UNDERLINE_CHARS = {
  topLeft: "\u250c",
  topRight: "\u2510",
  bottomLeft: "\u2514",
  bottomRight: "\u2518",
  horizontal: "\u203e",
  vertical: "\u2502",
  topT: "\u252c",
  bottomT: "\u2534",
  leftT: "\u251c",
  rightT: "\u2524",
  cross: "\u253c",
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
