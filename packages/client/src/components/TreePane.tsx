/**
 * The rail's Tree tab: the session's history as one row per entry. The active
 * path reads bright, everything else dim; a branch tip carries its name, the
 * current tip a marker, a checkpoint its label. Clicking a row selects it,
 * clicking the selected row goes there; the buttons underneath are the mouse
 * path to the same primitives the option chords reach.
 */

import React, { useEffect, useRef } from "react";
import { createTextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import type { TreeRow } from "../tree-view";
import { useComponentTheme } from "./theme-context";
import { Button } from "./primitives/Button";
import { Toolbar } from "./primitives/Toolbar";

export interface TreePaneProps {
  rows: TreeRow[];
  selectedEntryId?: string;
  /** The owner of an open review may move the tree; everyone else reads it. */
  canMove: boolean;
  /** The owner may fork, a resolved review included. */
  canFork: boolean;
  onSelect: (entryId: string) => void;
  onGo: (entryId: string) => void;
  onBranch: () => void;
  onLabel: () => void;
  onFork: () => void;
  onForkAndShare: () => void;
  theme?: Theme;
}

const DIM = createTextAttributes({ dim: true });
const BOLD = createTextAttributes({ bold: true });

/** The marker column: the current tip stands out, every other row keeps its kind's glyph. */
function markerFor(row: TreeRow): string {
  return row.isCurrentTip ? "●" : row.glyph;
}

/** What follows the entry's name: the branches whose tip it is, and its checkpoint. */
function trailerFor(row: TreeRow): string {
  const parts: string[] = [];

  if (row.tips.length) parts.push(`← ${row.tips.join(", ")}`);
  if (row.label !== undefined) parts.push(`⚑ ${row.label}`);

  return parts.length ? `  ${parts.join("  ")}` : "";
}

export function TreePane({
  rows,
  selectedEntryId,
  canMove,
  canFork,
  onSelect,
  onGo,
  onBranch,
  onLabel,
  onFork,
  onForkAndShare,
  theme,
}: TreePaneProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const revealId = selectedEntryId ?? rows.find((row) => row.isCurrentTip)?.entryId;

  // the trunk draws last, so a long history opens with its tip below the fold: keep the row in view
  useEffect(() => {
    if (revealId === undefined) return;
    try {
      scrollRef.current?.scrollChildIntoView(`tree-row-${revealId}`);
    } catch {
      // reveal is best-effort; the selection is already correct
    }
  }, [revealId]);

  if (rows.length === 0)
    return (
      <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
        <text fg={tokens.textDim}>no history yet</text>
      </box>
    );

  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} focused={false}>
        {rows.map((row) => {
          const selected = row.entryId === selectedEntryId;
          const foreground = row.onPath ? tokens.text : tokens.textDim;

          return (
            <box
              key={row.entryId}
              id={`tree-row-${row.entryId}`}
              style={{
                flexDirection: "row",
                paddingLeft: 1 + row.depth * 2,
                backgroundColor: selected ? tokens.elevated : undefined,
              }}
              onMouseUp={() => (selected && canMove ? onGo(row.entryId) : onSelect(row.entryId))}
            >
              <text
                fg={row.isCurrentTip ? tokens.accent : foreground}
                attributes={row.onPath ? undefined : DIM}
              >
                {markerFor(row)} {row.text}
              </text>
              <text fg={tokens.textMuted} attributes={row.label === undefined ? undefined : BOLD}>
                {trailerFor(row)}
              </text>
            </box>
          );
        })}
      </scrollbox>
      {canMove || canFork ? (
        <box style={{ paddingLeft: 1 }}>
          <Toolbar>
            {canMove ? (
              <Button
                onPress={() => {
                  if (selectedEntryId !== undefined) onGo(selectedEntryId);
                }}
                isDisabled={selectedEntryId === undefined}
                marginRight={1}
                theme={theme}
              >
                Go
              </Button>
            ) : null}
            {canMove ? (
              <Button onPress={onBranch} marginRight={1} theme={theme}>
                Branch
              </Button>
            ) : null}
            {canMove ? (
              <Button onPress={onLabel} marginRight={1} theme={theme}>
                Label
              </Button>
            ) : null}
            {canFork ? (
              <Button onPress={onFork} marginRight={1} theme={theme}>
                Fork
              </Button>
            ) : null}
            {canFork ? (
              <Button onPress={onForkAndShare} theme={theme}>
                Fork+share
              </Button>
            ) : null}
          </Toolbar>
        </box>
      ) : null}
    </box>
  );
}
