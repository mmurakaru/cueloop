// The Project pane in tree mode: the workspace's tracked files as a collapsible directory tree.
// Folders start collapsed and expand on click; a file click opens it as a tab. The caller keys this
// on the session id so switching sessions remounts it and never shows the previous repository's paths.

import { ScrollArea } from "./ScrollArea";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Tree } from "./primitives/Tree";
import { flattenTree } from "./primitives/tree-model";
import { buildPathTree } from "./file-tree";

export interface ProjectTreeViewProps {
  loadFiles: () => Promise<string[]>;
  onSelectFile: (path: string) => void;
  /** The pane owns the keyboard: j/k and arrows move the cursor, tab/enter open or fold. */
  focused?: boolean;
  theme?: Theme;
}

export function ProjectTreeView({
  loadFiles,
  onSelectFile,
  focused = false,
  theme,
}: ProjectTreeViewProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const [paths, setPaths] = useState<readonly string[] | null>(null);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const nodes = useMemo(() => (paths ? buildPathTree(paths) : []), [paths]);
  const rows = useMemo(() => flattenTree(nodes, { expandedIds }), [nodes, expandedIds]);
  const cursorIndex = Math.min(cursor, Math.max(0, rows.length - 1));
  const loadRef = useRef(loadFiles);
  useEffect(() => {
    loadRef.current = loadFiles;
  });

  const toggle = (id: string): void =>
    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

  useKeyboard((key) => {
    if (!focused || rows.length === 0) return;
    if (key.name === "j" || key.name === "down")
      return setCursor(Math.min(cursorIndex + 1, rows.length - 1));
    if (key.name === "k" || key.name === "up") return setCursor(Math.max(cursorIndex - 1, 0));
    const row = rows[cursorIndex];
    if (!row) return;
    if (key.name === "tab" || key.name === "return" || key.name === "enter")
      return row.isFolder ? toggle(row.id) : onSelectFile(row.id);
    if (key.name === "l" && row.isFolder && !expandedIds.has(row.id)) return toggle(row.id);
    if (key.name === "h" && row.isFolder && expandedIds.has(row.id)) return toggle(row.id);
  });

  useEffect(() => {
    let alive = true;
    void loadRef.current().then(
      (files) => {
        if (alive) setPaths(files);
      },
      () => {
        if (alive) setPaths([]);
      },
    );

    return () => {
      alive = false;
    };
  }, []);

  if (paths === null) {
    return (
      <box style={{ flexGrow: 1, paddingLeft: 1, paddingTop: 1 }}>
        <text fg={tokens.textDim}>loading...</text>
      </box>
    );
  }
  if (paths.length === 0) {
    return (
      <box style={{ flexGrow: 1, paddingLeft: 1, paddingTop: 1 }}>
        <text fg={tokens.textDim}>empty</text>
      </box>
    );
  }

  return (
    <ScrollArea>
      <Tree
        nodes={nodes}
        expandedIds={expandedIds}
        selectedId={focused ? rows[cursorIndex]?.id : undefined}
        onSelect={(id) => {
          const index = rows.findIndex((row) => row.id === id);

          if (index >= 0) setCursor(index);
          onSelectFile(id);
        }}
        onToggle={toggle}
        theme={theme}
      />
    </ScrollArea>
  );
}
