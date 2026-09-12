// A Changes file tab in contents mode: a workspace file rendered read-only with line numbers.
// Loads on mount and whenever the path changes; a null read shows a "could not read" hint.
// Syntax highlighting comes from the native code renderable (tree-sitter), with the language
// auto-detected from the path; unknown languages simply render unstyled.

import React, { useEffect, useRef, useState } from "react";
import type { CodeRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { filetypeForPath, syntaxStyleFor } from "./syntax-highlight";

export interface FileContentsViewProps {
  path: string;
  loadContents: (path: string) => Promise<string | null>;
  theme?: Theme;
}

/** A finished read for a specific path; `lines` is null when the file could not be read. */
interface FileLoad {
  path: string;
  lines: string[] | null;
}

export function FileContentsView({
  path,
  loadContents,
  theme,
}: FileContentsViewProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const [loaded, setLoaded] = useState<FileLoad | null>(null);
  // The gutter mirrors the code renderable's line info, so it needs the mounted
  // instance; a state-backed ref rebinds the target once the code renderable exists.
  const [codeTarget, setCodeTarget] = useState<CodeRenderable | null>(null);
  const loadRef = useRef(loadContents);
  useEffect(() => {
    loadRef.current = loadContents;
  });

  useEffect(() => {
    let alive = true;
    void loadRef.current(path).then(
      (contents) => {
        if (alive) setLoaded({ path, lines: contents === null ? null : contents.split("\n") });
      },
      () => {
        if (alive) setLoaded({ path, lines: null });
      },
    );

    return () => {
      alive = false;
    };
  }, [path]);

  if (loaded === null || loaded.path !== path) {
    return (
      <box style={{ flexGrow: 1, paddingLeft: 1, paddingTop: 1 }}>
        <text fg={tokens.textDim}>loading...</text>
      </box>
    );
  }
  if (loaded.lines === null) {
    return (
      <box style={{ flexGrow: 1, paddingLeft: 1, paddingTop: 1 }}>
        <text fg={tokens.textDim}>{`could not read ${path}`}</text>
      </box>
    );
  }
  const content = loaded.lines.join("\n");

  return (
    <scrollbox style={{ flexGrow: 1 }} focused={false}>
      <line-number
        target={codeTarget ?? undefined}
        showLineNumbers
        fg={tokens.textDim}
        minWidth={5}
        paddingRight={1}
        style={{ paddingTop: 1, paddingLeft: 1 }}
      >
        <code
          ref={setCodeTarget}
          content={content}
          filetype={filetypeForPath(path)}
          syntaxStyle={syntaxStyleFor(tokens)}
          selectable={false}
          style={{ wrapMode: "none", fg: tokens.text }}
        />
      </line-number>
    </scrollbox>
  );
}
