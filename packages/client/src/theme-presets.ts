/**
 * Named theme presets selectable from Settings and `[ui] theme`. The branded
 * "cueloop" default keeps the transparent terminal-through look; each of the
 * well-known palettes paints its own opaque background so it reads exactly like
 * the published theme. Every preset fills the full Theme token contract, so a
 * `[theme]` per-token override still layers cleanly on top of the chosen base.
 *
 * Each palette maps its first-party spec onto cueloop's semantic slots. Where a
 * palette has no dedicated green (Rosé Pine), additions use its positive accent
 * by that palette's own convention.
 */

import { DARK, type Theme } from "./theme";

/** Selectable theme name; the persisted `[ui] theme` value and cycle key. */
export type ThemeName =
  | "cueloop"
  | "rose-pine-moon"
  | "catppuccin-mocha"
  | "tokyo-night"
  | "gruvbox-dark"
  | "nord";

/** The branded default; the base every layered config starts from. */
export const DEFAULT_THEME_NAME: ThemeName = "cueloop";

/** Rosé Pine Moon - rosepinetheme.com. Foam stands in for additions (no green in the palette). */
const ROSE_PINE_MOON: Theme = {
  background: "#232136",
  panel: "#232136",
  elevated: "#2a273f",
  border: "#44415a",
  text: "#e0def4",
  textMuted: "#908caa",
  textDim: "#6e6a86",
  accent: "#ea9a97",
  accentInk: "#232136",
  green: "#9ccfd8",
  red: "#eb6f92",
  blue: "#3e8fb0",
  cursorBackground: "#382a2f",
  markCommentBackground: "#382a37",
  markSuggestionBackground: "#213736",
  insertedForeground: "#9ccfd8",
  deletedForeground: "#eb6f92",
  backdrop: "transparent",
};

/** Catppuccin Mocha - catppuccin.com. Mauve is the signature accent. */
const CATPPUCCIN_MOCHA: Theme = {
  background: "#1e1e2e",
  panel: "#1e1e2e",
  elevated: "#313244",
  border: "#45475a",
  text: "#cdd6f4",
  textMuted: "#a6adc8",
  textDim: "#6c7086",
  accent: "#cba6f7",
  accentInk: "#1e1e2e",
  green: "#a6e3a1",
  red: "#f38ba8",
  blue: "#89b4fa",
  cursorBackground: "#2e2740",
  markCommentBackground: "#33222b",
  markSuggestionBackground: "#22321f",
  insertedForeground: "#a6e3a1",
  deletedForeground: "#f38ba8",
  backdrop: "transparent",
};

/** Tokyo Night - the folke "night" variant. Magenta is the signature accent. */
const TOKYO_NIGHT: Theme = {
  background: "#1a1b26",
  panel: "#1a1b26",
  elevated: "#292e42",
  border: "#3b4261",
  text: "#c0caf5",
  textMuted: "#a9b1d6",
  textDim: "#565f89",
  accent: "#bb9af7",
  accentInk: "#1a1b26",
  green: "#9ece6a",
  red: "#f7768e",
  blue: "#7aa2f7",
  cursorBackground: "#2b2740",
  markCommentBackground: "#2f2230",
  markSuggestionBackground: "#21301f",
  insertedForeground: "#9ece6a",
  deletedForeground: "#f7768e",
  backdrop: "transparent",
};

/** Gruvbox Dark - morhetz/gruvbox, medium contrast. Orange is the warm signature accent. */
const GRUVBOX_DARK: Theme = {
  background: "#282828",
  panel: "#282828",
  elevated: "#3c3836",
  border: "#504945",
  text: "#ebdbb2",
  textMuted: "#d5c4a1",
  textDim: "#928374",
  accent: "#fe8019",
  accentInk: "#282828",
  green: "#b8bb26",
  red: "#fb4934",
  blue: "#83a598",
  cursorBackground: "#3a2f20",
  markCommentBackground: "#3a2823",
  markSuggestionBackground: "#2f3319",
  insertedForeground: "#b8bb26",
  deletedForeground: "#fb4934",
  backdrop: "transparent",
};

/** Nord - nordtheme.com, the official 16-color spec. Frost cyan is the signature accent. */
const NORD: Theme = {
  background: "#2e3440",
  panel: "#2e3440",
  elevated: "#3b4252",
  border: "#434c5e",
  text: "#eceff4",
  textMuted: "#d8dee9",
  textDim: "#4c566a",
  accent: "#88c0d0",
  accentInk: "#2e3440",
  green: "#a3be8c",
  red: "#bf616a",
  blue: "#81a1c1",
  cursorBackground: "#2a3540",
  markCommentBackground: "#3a2f33",
  markSuggestionBackground: "#313a30",
  insertedForeground: "#a3be8c",
  deletedForeground: "#bf616a",
  backdrop: "transparent",
};

/** All selectable themes by name; "cueloop" is the branded transparent default. */
export const THEME_PRESETS: Record<ThemeName, Theme> = {
  cueloop: DARK,
  "rose-pine-moon": ROSE_PINE_MOON,
  "catppuccin-mocha": CATPPUCCIN_MOCHA,
  "tokyo-night": TOKYO_NIGHT,
  "gruvbox-dark": GRUVBOX_DARK,
  nord: NORD,
};

/** Cycle order for the Settings theme row; the branded default leads. */
export const THEME_NAMES: ThemeName[] = [
  "cueloop",
  "rose-pine-moon",
  "catppuccin-mocha",
  "tokyo-night",
  "gruvbox-dark",
  "nord",
];

/** Human labels for the Settings cycle row, keyed by the persisted name. */
export const THEME_LABELS: Record<ThemeName, string> = {
  cueloop: "cueloop",
  "rose-pine-moon": "Rosé Pine Moon",
  "catppuccin-mocha": "Catppuccin Mocha",
  "tokyo-night": "Tokyo Night",
  "gruvbox-dark": "Gruvbox Dark",
  nord: "Nord",
};

/** Resolve a persisted theme name to its token set; unknown names fall back to the branded default. */
export function themeForName(name: string): Theme {
  return THEME_PRESETS[name as ThemeName] ?? DARK;
}

/** True when the name is a known preset (guards a persisted `[ui] theme` value). */
export function isThemeName(name: string): name is ThemeName {
  return name in THEME_PRESETS;
}
