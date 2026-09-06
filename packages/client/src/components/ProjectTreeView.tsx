// The Project pane in tree mode: the workspace's tracked files as a collapsible directory tree
// (a VS Code Explorer). Folders start collapsed and expand on click; a file click opens it as a tab.

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Tree } from "./primitives/Tree";
import { buildPathTree } from "./file-tree";

export interface ProjectTreeViewProps {
  loadFiles: () => Promise<string[]>;
  onSelectFile: (path: string) => void;
  theme?: Theme;
}

export function ProjectTreeView({
  loadFiles,
  onSelectFile,
  theme,
}: ProjectTreeViewProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const [paths, setPaths] = useState<readonly string[] | null>(null);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const nodes = useMemo(() => (paths ? buildPathTree(paths) : []), [paths]);
  const loadRef = useRef(loadFiles);
  useEffect(() => {
    loadRef.current = loadFiles;
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
    <scrollbox style={{ flexGrow: 1 }} focused={false}>
      <Tree
        nodes={nodes}
        expandedIds={expandedIds}
        onSelect={onSelectFile}
        onToggle={(id) =>
          setExpandedIds((current) => {
            const next = new Set(current);

            if (next.has(id)) next.delete(id);
            else next.add(id);

            return next;
          })
        }
        theme={theme}
      />
    </scrollbox>
  );
}
