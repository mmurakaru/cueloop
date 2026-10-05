// The Project pane in tree mode: the workspace's tracked files as a collapsible directory tree.
// Folders start collapsed and expand on click; a file click opens it as a tab. The caller keys this
// on the session id so switching sessions remounts it and never shows the previous repository's paths.

import { ScrollArea } from "../../ui/components/ScrollArea";
import React, { useEffect, useEffectEvent, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Theme } from "../../appearance/theme";
import { useComponentTheme } from "../../appearance/components/theme-context";
import { Tree } from "../../ui/components/primitives/Tree";
import { flattenTree } from "../../ui/components/primitives/tree-model";
import { buildPathTree } from "./file-tree";

const PROJECT_FILES_REFRESH_MS = 2000;

export interface ProjectTreeViewProps {
  loadFiles: () => Promise<string[]>;
  onSelectFile: (path: string, persistent?: boolean) => void;
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
  const [cursorId, setCursorId] = useState<string | null>(null);
  const nodes = useMemo(() => (paths ? buildPathTree(paths) : []), [paths]);
  const rows = useMemo(() => flattenTree(nodes, { expandedIds }), [nodes, expandedIds]);
  const cursorIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === cursorId),
  );
  const loadLatestFiles = useEffectEvent(loadFiles);

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
      return setCursorId(rows[Math.min(cursorIndex + 1, rows.length - 1)]!.id);
    if (key.name === "k" || key.name === "up")
      return setCursorId(rows[Math.max(cursorIndex - 1, 0)]!.id);
    const row = rows[cursorIndex];

    if (!row) return;
    if (key.name === "return" || key.name === "enter")
      return row.isFolder ? toggle(row.id) : onSelectFile(row.id, true);
    if (key.name === "l" && row.isFolder && !expandedIds.has(row.id)) return toggle(row.id);
    if (key.name === "h" && row.isFolder && expandedIds.has(row.id)) return toggle(row.id);
  });

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;

    const refreshFiles = async (): Promise<void> => {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const files = await loadLatestFiles();

        if (!cancelled) {
          setPaths((previous) =>
            previous?.length === files.length &&
            previous.every((path, index) => path === files[index])
              ? previous
              : files,
          );
        }
      } catch {
        if (!cancelled) setPaths((previous) => previous ?? []);
      } finally {
        requestInFlight = false;
      }
    };

    void refreshFiles();
    const timer = setInterval(() => void refreshFiles(), PROJECT_FILES_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (paths === null) {
    return (
      <box
        style={{
          flexGrow: 1,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <text fg={tokens.textDim}>loading...</text>
      </box>
    );
  }
  if (paths.length === 0) {
    return (
      <box
        style={{
          flexGrow: 1,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <text fg={tokens.textDim}>empty</text>
      </box>
    );
  }

  return (
    <ScrollArea
      id="tree-scroll"
      revealId={focused ? rows[cursorIndex]?.id : undefined}
      gestureWheel
    >
      <Tree
        nodes={nodes}
        expandedIds={expandedIds}
        selectedId={focused ? rows[cursorIndex]?.id : undefined}
        singleLine
        onSelect={(id) => {
          setCursorId(id);
          onSelectFile(id);
        }}
        onDoubleSelect={(id) => onSelectFile(id, true)}
        onToggle={toggle}
        theme={theme}
      />
    </ScrollArea>
  );
}
