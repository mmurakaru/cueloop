// OpenTUI renderer for the headless tree-model; the caller owns expansion and selection.

import React, { useRef } from "react";
import { DARK, type Theme } from "../../../appearance/theme";
import { isDoubleClick, type ClickStamp } from "../../../annotations/thread-selection";
import { flattenTree, statusMeta, type TreeNode, type TreeTone } from "./tree-model";
import { NERD_TREE_ICONS, type TreeIcons } from "./icons";

export interface TreeProps {
  nodes: readonly TreeNode[];
  expandedIds: ReadonlySet<string>;
  selectedId?: string;
  flattenEmptyDirectories?: boolean;
  showStatus?: boolean;
  hideIcons?: boolean;
  singleLine?: boolean;
  selectedBackground?: string;
  indentWidth?: number;
  icons?: TreeIcons;
  onSelect?: (id: string) => void;
  onDoubleSelect?: (id: string) => void;
  onToggle?: (id: string) => void;
  theme?: Theme;
}

function rowGlyph(isFolder: boolean, expanded: boolean, icons: TreeIcons): string {
  if (!isFolder) return icons.leaf;

  return expanded ? icons.expanded : icons.collapsed;
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
  hideIcons,
  singleLine = false,
  selectedBackground,
  indentWidth = 2,
  icons = NERD_TREE_ICONS,
  onSelect,
  onDoubleSelect,
  onToggle,
  theme,
}: TreeProps): React.ReactNode {
  const tokens = theme ?? DARK;
  const selectedBackdrop = selectedBackground ?? tokens.elevated;
  const rows = flattenTree(nodes, { expandedIds, flattenEmptyDirectories });
  const lastClick = useRef<{ id: string; stamp: ClickStamp } | null>(null);

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
              justifyContent: "space-between",
              height: singleLine ? 1 : undefined,
              overflow: singleLine ? "hidden" : undefined,
              paddingLeft: 1 + row.depth * indentWidth,
              paddingRight: singleLine && status ? 0 : 1,
              backgroundColor: selected ? selectedBackdrop : undefined,
            }}
            onMouseUp={(event) => {
              const stamp = { time: Date.now(), x: event.x, y: event.y };
              const doubleClick =
                lastClick.current?.id === row.id && isDoubleClick(lastClick.current.stamp, stamp);

              lastClick.current = { id: row.id, stamp };

              if (row.isFolder) onToggle?.(row.id);
              else {
                onSelect?.(row.id);

                if (doubleClick) onDoubleSelect?.(row.id);
              }
            }}
          >
            <box
              style={{
                flexDirection: "row",
                flexShrink: 1,
                minWidth: 0,
                overflow: singleLine ? "hidden" : undefined,
              }}
            >
              {hideIcons ? null : (
                <text fg={row.isFolder ? tokens.blue : tokens.textDim}>
                  {row.icon ?? rowGlyph(row.isFolder, row.expanded, icons)}{" "}
                </text>
              )}
              <box style={{ flexShrink: 1, minWidth: 0 }}>
                <text
                  id={`tree-label-${row.id}`}
                  fg={selected ? tokens.accent : labelColor}
                  wrapMode={singleLine ? "none" : undefined}
                  truncate={!singleLine}
                >
                  {singleLine ? `${row.label}  ` : row.label}
                </text>
              </box>
            </box>
            <box style={{ flexDirection: "row", flexShrink: 0 }}>
              {row.badge !== undefined ? <text fg={tokens.textDim}>{row.badge}</text> : null}
              {status ? <text fg={toneColor(status.tone, tokens)}> {status.letter}</text> : null}
            </box>
          </box>
        );
      })}
    </box>
  );
}
