// A Changes file tab in contents mode: a workspace file rendered read-only with line numbers.
// Loads on mount and whenever the path changes; a null read shows a "could not read" hint.

import React, { useEffect, useRef, useState } from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";

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
  const lines = loaded.lines;

  return (
    <scrollbox style={{ flexGrow: 1 }} focused={false}>
      <box style={{ flexDirection: "column", paddingTop: 1 }}>
        {lines.map((line, index) => (
          <box key={index} style={{ flexDirection: "row", paddingLeft: 1 }}>
            <box style={{ width: 5 }}>
              <text fg={tokens.textDim}>{String(index + 1).padStart(4)}</text>
            </box>
            <text fg={tokens.text}>{line.length > 0 ? line : " "}</text>
          </box>
        ))}
      </box>
    </scrollbox>
  );
}
