/**
 * Code highlighting tokens: the theme's named colors projected onto tree-sitter
 * capture names. One group -> color map is the single source of truth, feeding
 * both the native code renderable (via a cached SyntaxStyle per theme) and the
 * diff sheet's per-row spans. Unknown languages simply render unstyled -
 * highlighting is an enhancement, never a blocker.
 */

import {
  SyntaxStyle,
  infoStringToFiletype,
  extensionToFiletype,
  basenameToFiletype,
} from "@opentui/core";
import type { Theme } from "../theme";

/** Markdown fence info -> tree-sitter filetype, with the aliases we accept. */
export function filetypeFor(language?: string): string | undefined {
  const info = (language ?? "").toLowerCase();

  if (!info) return undefined;
  const aliases: SyntaxAliases = {
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

/** A diff/code file path -> tree-sitter filetype, by basename then extension. */
export function filetypeForPath(path: string): string | undefined {
  const basename = path.split("/").pop() ?? path;
  const byBasename = basenameToFiletype.get(basename);

  if (byBasename) return byBasename;
  const dotIndex = basename.lastIndexOf(".");

  if (dotIndex <= 0) return undefined;

  return extensionToFiletype.get(basename.slice(dotIndex + 1).toLowerCase());
}

interface SyntaxAliases {
  [alias: string]: string;
}

interface SyntaxGroupStyle {
  fg: string;
  italic?: boolean;
}

interface SyntaxGroupStyles {
  [group: string]: SyntaxGroupStyle;
}

/** The one group -> style map, keyed by tree-sitter capture name. */
function syntaxGroupStyles(theme: Theme): SyntaxGroupStyles {
  return {
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
  };
}

const syntaxStyleCache = new WeakMap<Theme, SyntaxStyle>();

export function syntaxStyleFor(theme: Theme): SyntaxStyle {
  const cached = syntaxStyleCache.get(theme);

  if (cached) return cached;
  const style = SyntaxStyle.fromStyles(syntaxGroupStyles(theme));

  syntaxStyleCache.set(theme, style);

  return style;
}

/** The foreground for a tree-sitter capture group; undefined when unstyled. */
export function colorForSyntaxGroup(group: string, theme: Theme): string | undefined {
  const styles = syntaxGroupStyles(theme);
  const direct = styles[group];

  if (direct) return direct.fg;
  // capture names are dotted (e.g. "keyword.control"); match the broadest prefix
  const base = group.split(".")[0]!;

  return styles[base]?.fg;
}
