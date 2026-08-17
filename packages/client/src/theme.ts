/**
 * Semantic theme tokens. Values carry over from the design-system
 * prototypes (tokens.css). One built-in dark theme for now; the theme
 * registry (palette-derived themes, terminal theme, user overrides) layers
 * on top of these slots without touching consumers.
 */

export interface Theme {
  bg: string;
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
  cursorBg: string;
  markCommentBg: string;
  markSuggestionBg: string;
  insFg: string;
  delFg: string;
  /** Dimmed layer painted behind centered dialogs. */
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
    insFg: theme.textDim,
    delFg: theme.textDim,
  };
}

export const DARK: Theme = {
  /* Unpainted so the terminal background shows through; override in [theme]. */
  bg: "transparent",
  panel: "transparent",
  elevated: "#23232f",
  border: "#3a3a4a",
  text: "#e4e6ec",
  textMuted: "#b1b6c4",
  textDim: "#6b7280",
  accent: "#f5a3a3",
  accentInk: "#2a1416",
  green: "#62d96b",
  red: "#ff6b6b",
  blue: "#84a6e8",
  cursorBg: "#33262a",
  markCommentBg: "#3d2a2e",
  markSuggestionBg: "#20351f",
  insFg: "#62d96b",
  delFg: "#ff6b6b",
  backdrop: "#14141b",
}
