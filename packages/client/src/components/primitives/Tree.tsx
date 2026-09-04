// OpenTUI renderer for the headless tree-model; the caller owns expansion and selection.

import React from "react";
import { DARK, type Theme } from "../../theme";
import { flattenTree, statusMeta, type TreeNode, type TreeTone } from "./tree-model";

export interface TreeProps {
  nodes: readonly TreeNode[];
  expandedIds: ReadonlySet<string>;
  selectedId?: string;
  flattenEmptyDirectories?: boolean;
  showStatus?: boolean;
  indentWidth?: number;
  onSelect?: (id: string) => void;
  onToggle?: (id: string) => void;
  theme?: Theme;
}

function twisty(isFolder: boolean, expanded: boolean): string {
  if (!isFolder) return " ";

  return expanded ? "▾" : "▸";
}

function toneColor(tone: TreeTone, theme: Theme): string {
  if (tone === "green") return theme.green;
  if (tone === "blue") return theme.blue;
  if (tone === "red") return theme.red;

  return theme.textDim;
}

export function Tree({
  nodes,
  expandedIds,
  selectedId,
  flattenEmptyDirectories,
  showStatus,
  indentWidth = 2,
  onSelect,
  onToggle,
  theme,
}: TreeProps): React.ReactNode {
  const tokens = theme ?? DARK;
  const rows = flattenTree(nodes, { expandedIds, flattenEmptyDirectories });

  return (
    <box style={{ flexDirection: "column" }}>
      {rows.map((row) => {
        const selected = row.id === selectedId;
        const status = showStatus && row.status !== undefined ? statusMeta(row.status) : null;
        const labelColor = selected
          ? tokens.text
          : status
            ? toneColor(status.tone, tokens)
            : row.isFolder
              ? tokens.text
              : tokens.textMuted;

        return (
          <box
            key={row.id}
            id={`tree-row-${row.id}`}
            style={{
              flexDirection: "row",
              paddingLeft: 1 + row.depth * indentWidth,
              paddingRight: 1,
              backgroundColor: selected ? tokens.elevated : undefined,
            }}
            onMouseUp={() => (row.isFolder ? onToggle?.(row.id) : onSelect?.(row.id))}
          >
            <text fg={row.isFolder ? tokens.textDim : "transparent"}>
              {twisty(row.isFolder, row.expanded)}{" "}
            </text>
            {row.icon !== undefined ? <text fg={tokens.textDim}>{row.icon} </text> : null}
            <text fg={selected ? tokens.accent : labelColor}>{row.label}</text>
            <box style={{ flexGrow: 1 }} />
            {row.badge !== undefined ? <text fg={tokens.textDim}>{row.badge}</text> : null}
            {status ? <text fg={toneColor(status.tone, tokens)}> {status.letter}</text> : null}
          </box>
        );
      })}
    </box>
  );
}
