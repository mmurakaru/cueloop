/**
 * Code highlighting tokens: the theme's named tokens projected onto
 * tree-sitter capture names for the native code renderable. One SyntaxStyle
 * per theme object, cached, so every code block on screen shares a handle.
 * Unknown languages simply render unstyled - highlighting is an enhancement,
 * never a blocker.
 */

import { SyntaxStyle, infoStringToFiletype } from "@opentui/core";
import type { Theme } from "../theme";

/** Markdown fence info -> tree-sitter filetype, with the aliases we accept. */
export function filetypeFor(language?: string): string | undefined {
  const info = (language ?? "").toLowerCase();
  if (!info) return undefined;
  const aliases: Record<string, string> = {
    ts: "typescript",
    js: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
  };
  return infoStringToFiletype(aliases[info] ?? info) ?? aliases[info] ?? info;
}

const syntaxStyleCache = new WeakMap<Theme, SyntaxStyle>();

export function syntaxStyleFor(theme: Theme): SyntaxStyle {
  const cached = syntaxStyleCache.get(theme);
  if (cached) return cached;
  const style = SyntaxStyle.fromStyles({
    default: { fg: theme.textMuted },
    comment: { fg: theme.textDim, italic: true },
    string: { fg: theme.green },
    number: { fg: theme.blue },
    constant: { fg: theme.blue },
    boolean: { fg: theme.blue },
    keyword: { fg: theme.accent },
    operator: { fg: theme.textDim },
    punctuation: { fg: theme.textDim },
    function: { fg: theme.text },
    method: { fg: theme.text },
    type: { fg: theme.blue },
    constructor: { fg: theme.blue },
    variable: { fg: theme.textMuted },
    property: { fg: theme.textMuted },
    parameter: { fg: theme.textMuted },
    tag: { fg: theme.accent },
    attribute: { fg: theme.blue },
  });
  syntaxStyleCache.set(theme, style);
  return style;
}
