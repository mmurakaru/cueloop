/**
 * Semantic theme tokens. Values carry over from the design-system
 * prototypes (tokens.css). One built-in dark theme for now; the theme
 * registry (palette-derived themes, terminal theme, user overrides) layers
 * on top of these slots without touching consumers.
 */

export interface Theme {
  background: string;
  panel: string;
  elevated: string;
  border: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentInk: string;
  green: string;
  red: string;
  blue: string;
  cursorBackground: string;
  markCommentBackground: string;
  insertedForeground: string;
  deletedForeground: string;
  /** Layer behind centered dialogs; transparent keeps the session visible. */
  backdrop: string;
}

/**
 * The dimmed variant behind the walk wizard: every reading color drops to
 * the dim token so the file list stays legible context, not competition.
 * Layout tokens (backgrounds, cursor) keep their values.
 */
export function dimmedTheme(theme: Theme): Theme {
  return {
    ...theme,
    text: theme.textDim,
    textMuted: theme.textDim,
    accent: theme.textDim,
    green: theme.textDim,
    red: theme.textDim,
    blue: theme.textDim,
    insertedForeground: theme.textDim,
    deletedForeground: theme.textDim,
  };
}

export const DARK: Theme = {
  /* Unpainted so the terminal background shows through; override in [theme]. */
  background: "transparent",
  panel: "transparent",
  elevated: "#23232f",
  border: "#3a3a4a",
  text: "#e4e6ec",
  textMuted: "#b1b6c4",
  textDim: "#6b7280",
  accent: "#f5a3a3",
  accentInk: "#2a1416",
  green: "#62d96b",
  red: "#f08080",
  blue: "#a9c8f5",
  cursorBackground: "#33262a",
  markCommentBackground: "#3d2a2e",
  insertedForeground: "#62d96b",
  deletedForeground: "#ff6b6b",
  backdrop: "transparent",
};
