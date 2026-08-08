/**
 * Code-block syntax highlighting via Shiki (#67): TextMate-grammar tokens
 * colored by a theme built from cueloop's tokens. The highlighter loads
 * lazily on the first code block; unknown languages render unstyled.
 */

import { DARK as T } from "./theme";

export interface CodeToken {
  content: string;
  color?: string;
}

type Highlighter = {
  codeToTokensBase(code: string, opts: { lang: string; theme: string }): { content: string; color?: string }[][];
  getLoadedLanguages(): string[];
};

const LANGS = ["typescript", "tsx", "javascript", "jsx", "json", "bash", "python", "rust", "go", "yaml", "diff", "markdown", "toml", "sql", "html", "css"];

/** Markdown fence info → Shiki language id. */
export function filetypeFor(lang?: string): string {
  const l = (lang ?? "").toLowerCase();
  const map: Record<string, string> = {
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
  return map[l] ?? l;
}

function cueloopTheme() {
  const scope = (scopes: string, foreground: string, fontStyle?: string) => ({
    scope: scopes.split(", "),
    settings: fontStyle ? { foreground, fontStyle } : { foreground },
  });
  return {
    name: "cueloop",
    type: "dark" as const,
    colors: { "editor.background": T.elevated, "editor.foreground": T.textMuted },
    settings: [
      { settings: { foreground: T.textMuted } },
      scope("comment, punctuation.definition.comment", T.textDim, "italic"),
      scope("string, string.quoted, punctuation.definition.string", T.green),
      scope("constant.numeric, constant.language, constant.character", T.blue),
      scope("keyword, storage, storage.type, storage.modifier, keyword.control", T.accent),
      scope("entity.name.function, support.function, meta.function-call", T.text),
      scope("entity.name.type, entity.name.class, support.type, support.class", T.blue),
      scope("variable, variable.other, variable.parameter", T.textMuted),
      scope("entity.name.tag", T.accent),
      scope("entity.other.attribute-name", T.blue),
      scope("punctuation, meta.brace", T.textDim),
      scope("keyword.operator", T.textDim),
    ],
  };
}

let highlighterPromise: Promise<Highlighter | null> | null = null;

function getHighlighter(): Promise<Highlighter | null> {
  highlighterPromise ??= import("shiki")
    .then((shiki) => shiki.createHighlighter({ themes: [cueloopTheme()], langs: LANGS }) as Promise<Highlighter>)
    .catch(() => null); // highlighting is an enhancement, never a blocker
  return highlighterPromise;
}

/**
 * Tokenize code into styled lines. Token text concatenates back to the exact
 * source line, so verbatim rendering (indentation, no wrap) is preserved.
 * Returns null when the language is unknown or the highlighter is unavailable.
 */
export async function highlightCode(content: string, lang?: string): Promise<CodeToken[][] | null> {
  const language = filetypeFor(lang);
  if (!language) return null;
  const highlighter = await getHighlighter();
  if (!highlighter || !highlighter.getLoadedLanguages().includes(language)) return null;
  try {
    return highlighter.codeToTokensBase(content, { lang: language, theme: "cueloop" });
  } catch {
    return null;
  }
}
