/** Syntax highlighting for code blocks: theme tokens mapped onto tree-sitter capture names. */

import { SyntaxStyle } from "@opentui/core";
import { DARK as T } from "./theme";

let cached: SyntaxStyle | null = null;

export function syntaxStyle(): SyntaxStyle {
  if (cached) return cached;
  cached = SyntaxStyle.fromStyles({
    default: { fg: T.textMuted },
    keyword: { fg: T.accent },
    "keyword.return": { fg: T.accent },
    "keyword.function": { fg: T.accent },
    string: { fg: T.green },
    "string.special": { fg: T.green },
    comment: { fg: T.textDim, italic: true },
    number: { fg: T.blue },
    constant: { fg: T.blue },
    boolean: { fg: T.blue },
    function: { fg: T.text },
    "function.method": { fg: T.text },
    type: { fg: T.blue },
    "type.builtin": { fg: T.blue },
    variable: { fg: T.textMuted },
    property: { fg: T.textMuted },
    operator: { fg: T.textDim },
    punctuation: { fg: T.textDim },
    "punctuation.bracket": { fg: T.textDim },
    "punctuation.delimiter": { fg: T.textDim },
    tag: { fg: T.accent },
    attribute: { fg: T.blue },
  });
  return cached;
}

/** Markdown fence info → tree-sitter filetype. Unknown languages render unstyled. */
export function filetypeFor(lang?: string): string {
  const l = (lang ?? "").toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    shell: "bash",
    yml: "yaml",
  };
  return map[l] ?? l;
}
