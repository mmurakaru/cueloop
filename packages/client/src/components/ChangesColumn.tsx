// The right-hand Changes column: the diff's changed files as a directory tree.
// A click on a file scrolls the diff to that file. Renders nothing when collapsed
// so the diff reclaims the width. Mirrors the left Threads column on the far side.
// Co-located here: the state hook that opens it by context and the header toggle.

import { ScrollArea } from "./ScrollArea";
import React, { useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { DiffFileContents, Thread } from "@cueloop/schema";
import type { Theme } from "../theme";
import type { DiffRow } from "../view-diff";
import { Tree } from "./primitives/Tree";
import { allFolderIds, flattenTree } from "./primitives/tree-model";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";
import { buildFileTree } from "./file-tree";

export interface DiffColumnsState {
  changesOpen: boolean;
  toggleChanges: () => void;
  /** The path under the diff cursor, highlighted in the Changes tree. */
  currentFilePath?: string;
  scrollToFile: (path: string) => void;
}

/**
 * Owns the right Changes column for a diff: context opens it when you enter a
 * diff thread, and a file click scrolls the sheet to that file's first row.
 * Resets on session change via the guarded render-time pattern, no effect.
 */
export function useDiffColumns(params: {
  session: Thread | null;
  rows: DiffRow[];
  cursor: number;
  setCursor: (index: number) => void;
}): DiffColumnsState {
  const { session, rows, cursor, setCursor } = params;
  const contextDefault = session?.artifact.type === "diff";
  const [changesOpen, setChangesOpen] = useState(contextDefault);
  const [seenSessionId, setSeenSessionId] = useState(session?.id);

  // entering another thread lets context decide again; within a thread the manual toggle stays
  if (session?.id !== seenSessionId) {
    setSeenSessionId(session?.id);
    setChangesOpen(contextDefault);
  }

  return {
    changesOpen,
    toggleChanges: () => setChangesOpen((open) => !open),
    currentFilePath: rows[cursor]?.file,
    scrollToFile: (path: string) => {
      const fileRowIndex = rows.findIndex((row) => row.kind === "file" && row.file === path);

      if (fileRowIndex >= 0) setCursor(fileRowIndex);
    },
  };
}

/** The header toggle for the Changes column; shown only for a diff, where files exist to browse. */
export function DiffChangesToggle({
  isDiff,
  open,
  onToggle,
  theme,
}: {
  isDiff: boolean;
  open: boolean;
  onToggle: () => void;
  theme?: Theme;
}): React.ReactNode {
  if (!isDiff) return null;

  return (
    <IconButton
      glyph={open ? NERD.sidebarRight : NERD.sidebarRightOff}
      onPress={onToggle}
      marginLeft={2}
      theme={theme}
    />
  );
}

export interface ChangesColumnProps {
  open: boolean;
  files?: readonly DiffFileContents[];
  /** The path whose diff the sheet is scrolled to, highlighted in the tree. */
  selectedPath?: string;
  onSelectFile: (path: string) => void;
  /** Comments per file path, shown as a dot-and-count badge on each entry. */
  commentCounts?: ReadonlyMap<string, number>;
  focused?: boolean;
  width?: number;
  theme?: Theme;
}

/**
 * The changed-files tree on its own, with no surrounding column frame: the body
 * a workbench Project pane renders. A file click scrolls the diff to that file.
 */
export function ChangesFileTree({
  files = [],
  selectedPath,
  onSelectFile,
  commentCounts,
  focused = false,
  theme,
}: Omit<ChangesColumnProps, "open" | "width">): React.ReactNode {
  const nodes = useMemo(() => buildFileTree(files, commentCounts), [files, commentCounts]);
  // every folder opens by default so each changed file is reachable; the user
  // only ever names the folders they fold shut, so a new file set stays open
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const expandedIds = useMemo(() => {
    const expanded = allFolderIds(nodes);

    for (const id of collapsedIds) expanded.delete(id);

    return expanded;
  }, [nodes, collapsedIds]);
  const rows = useMemo(
    () => flattenTree(nodes, { expandedIds, flattenEmptyDirectories: true }),
    [nodes, expandedIds],
  );
  const cursorIndex = Math.min(cursor, Math.max(0, rows.length - 1));

  const toggle = (id: string): void =>
    setCollapsedIds((current) => {
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
    if (key.name === "l" && row.isFolder && collapsedIds.has(row.id)) return toggle(row.id);
    if (key.name === "h" && row.isFolder && !collapsedIds.has(row.id)) return toggle(row.id);
  });

  return (
    <ScrollArea>
      <Tree
        nodes={nodes}
        expandedIds={expandedIds}
        selectedId={focused ? rows[cursorIndex]?.id : selectedPath}
        flattenEmptyDirectories
        showStatus
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

export function ChangesColumn({
  open,
  files = [],
  selectedPath,
  onSelectFile,
  width = 32,
  theme,
}: ChangesColumnProps): React.ReactNode {
  if (!open) return null;

  return (
    <box
      style={{
        width,
        flexDirection: "column",
        borderStyle: "single",
        border: ["left"],
        borderColor: theme?.border,
      }}
    >
      <ChangesFileTree
        files={files}
        selectedPath={selectedPath}
        onSelectFile={onSelectFile}
        theme={theme}
      />
    </box>
  );
}
