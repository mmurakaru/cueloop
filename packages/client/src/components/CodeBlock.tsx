/**
 * Fenced code block: verbatim lines in a contained elevated box, highlighted
 * by the native code renderable (tree-sitter). Unstyled text draws first, so
 * the content never flashes empty while highlights resolve; unknown languages
 * stay unstyled.
 */

import React from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { filetypeFor, syntaxStyleFor } from "./syntax-highlight";

export interface CodeBlockProps {
  id?: string;
  /** Markdown fence info string ("tsx", "python", ...). */
  language?: string;
  content: string;
  isCursor?: boolean;
  /** Vertical rhythm above the block. */
  marginTop?: number;
  isAnnotated?: boolean;
  /** Working-copy change tag rendered after the language label. */
  changeTag?: "cut" | "new" | "edited";
  theme?: Theme;
}

export function CodeBlock({
  id,
  language,
  content,
  isCursor = false,
  marginTop = 0,
  isAnnotated = false,
  changeTag,
  theme,
}: CodeBlockProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const tagColor = changeTag === "cut" ? tokens.red : changeTag === "new" ? tokens.green : tokens.accent;
  return (
    <box id={id} style={{ flexDirection: "column", marginTop }}>
      <text>
        <span fg={isCursor ? tokens.accent : tokens.textDim}>{isCursor ? "▎ " : "  "}</span>
        <span fg={tokens.textDim}>{language ?? "code"}</span>
        {isAnnotated ? <span fg={tokens.accent}> ◆</span> : null}
        {changeTag ? <span fg={tagColor}> [{changeTag}]</span> : null}
      </text>
      <box
        style={{
          flexDirection: "column",
          backgroundColor: tokens.elevated,
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
          marginLeft: 2,
        }}
      >
        <code
          content={content}
          filetype={filetypeFor(language)}
          syntaxStyle={syntaxStyleFor(tokens)}
          selectable={false}
          style={{ wrapMode: "none", fg: tokens.textMuted, bg: tokens.elevated }}
        />
      </box>
    </box>
  );
}
