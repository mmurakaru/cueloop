/**
 * The pending-review inbox: a Pinned / Projects / Threads tree. Selection stays
 * with the keyboard grammar - the cursor indexes the flat thread order and this
 * component renders the snapshot. A hovered or selected thread reveals a kebab
 * that opens an inline pin / rename / delete menu; long titles fade on the right
 * instead of wrapping. App supplies the surrounding chrome.
 */

import React, { useState } from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";
import { fadeTitle } from "./fade-title";
import { threadTitle, type InboxRow } from "./session-tree";

export interface InboxListProps {
  rows: InboxRow[];
  cursor: number;
  /** The open thread's id; highlights it instead of the cursor (the left sidebar case). */
  activeId?: string;
  /** Ids of pinned threads; a pinned row carries the pin glyph and the menu offers Unpin. */
  pinnedIds?: ReadonlySet<string>;
  /** The column width, so titles fade to fit one line. */
  width?: number;
  /** Open a thread by clicking its row (the left sidebar case). */
  onSelect?: (sessionId: string) => void;
  /** Ask to delete a thread (the menu's Delete, wired to the confirm dialog). */
  onRequestDelete?: (id: string, title: string) => void;
  /** Toggle a thread's pinned state (the menu's Pin/Unpin). */
  onPin?: (id: string) => void;
  /** Rename a thread's title (the menu's Rename). */
  onRename?: (id: string, title: string) => void;
  theme?: Theme;
}

function ActionsMenu({
  pinned,
  onPin,
  onRename,
  onDelete,
  tokens,
}: {
  pinned: boolean;
  onPin?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  tokens: Theme;
}): React.ReactNode {
  const item = (
    glyph: string,
    label: string,
    color: string,
    onPick?: () => void,
  ): React.ReactNode =>
    onPick !== undefined ? (
      <box onMouseUp={onPick} style={{ flexDirection: "row", paddingLeft: 4, paddingRight: 1 }}>
        <text fg={color}>{`${glyph} ${label}`}</text>
      </box>
    ) : null;

  return (
    <box
      style={{
        flexDirection: "column",
        marginLeft: 3,
        borderStyle: "single",
        border: ["left"],
        borderColor: tokens.border,
      }}
    >
      {item(NERD.pin, pinned ? "Unpin" : "Pin", tokens.text, onPin)}
      {item(NERD.file, "Rename", tokens.text, onRename)}
      {item(NERD.close, "Delete", tokens.red, onDelete)}
    </box>
  );
}

interface ThreadRowProps {
  title: string;
  selected: boolean;
  pinned: boolean;
  titleWidth: number;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onSelect?: () => void;
  onPin?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  tokens: Theme;
  theme?: Theme;
}

function ThreadRow(props: ThreadRowProps): React.ReactNode {
  const { title, selected, pinned, titleWidth, menuOpen, onToggleMenu, tokens, theme } = props;
  const [hovered, setHovered] = useState(false);
  const segments = fadeTitle(
    title,
    titleWidth,
    selected ? tokens.accent : tokens.textMuted,
    tokens.background,
  );
  const hasActions =
    props.onPin !== undefined || props.onRename !== undefined || props.onDelete !== undefined;

  return (
    <box style={{ flexDirection: "column" }} onMouseOut={() => setHovered(false)}>
      <box
        onMouseUp={props.onSelect}
        onMouseOver={() => setHovered(true)}
        style={{
          flexDirection: "row",
          backgroundColor: selected ? tokens.elevated : hovered ? tokens.panel : undefined,
        }}
      >
        <text>
          <span fg={tokens.textDim}>{pinned ? ` ${NERD.pin} ` : "   "}</span>
          {segments.map((segment, index) => (
            <span key={index} fg={segment.fg}>
              {segment.text}
            </span>
          ))}
        </text>
        <box style={{ flexGrow: 1 }} />
        {(hovered || selected || menuOpen) && hasActions ? (
          <IconButton
            glyph={NERD.kebab}
            active={menuOpen}
            onPress={onToggleMenu}
            marginRight={1}
            theme={theme}
          />
        ) : null}
      </box>
      {menuOpen ? (
        <ActionsMenu
          pinned={pinned}
          onPin={props.onPin}
          onRename={props.onRename}
          onDelete={props.onDelete}
          tokens={tokens}
        />
      ) : null}
    </box>
  );
}

export function InboxList({
  rows,
  cursor,
  activeId,
  pinnedIds,
  width = 30,
  onSelect,
  onRequestDelete,
  onPin,
  onRename,
  theme,
}: InboxListProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const [actionsForId, setActionsForId] = useState<string | null>(null);
  // leave room for the 3-char prefix, the border, and the hover kebab so a row
  // never wraps: the title fades to fit whatever is left
  const titleWidth = Math.max(8, width - 9);
  const closeMenu = (): void => setActionsForId(null);

  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      {rows.length === 0 ? (
        <text fg={tokens.textDim}>nothing waiting for review</text>
      ) : (
        rows.map((row) => {
          if (row.kind === "section") {
            return (
              <text key={row.id} fg={tokens.textDim}>
                {row.label}
              </text>
            );
          }

          if (row.kind === "project") {
            return (
              <text key={row.id}>
                <span fg={tokens.blue}>{` ${NERD.folderOpen} `}</span>
                <span fg={tokens.textMuted}>{row.label}</span>
              </text>
            );
          }

          const id = row.session.id;
          const title = threadTitle(row.session);

          return (
            <ThreadRow
              key={row.id}
              title={title}
              selected={activeId !== undefined ? activeId === id : row.selectionIndex === cursor}
              pinned={pinnedIds?.has(id) ?? false}
              titleWidth={titleWidth}
              menuOpen={actionsForId === id}
              onToggleMenu={() => setActionsForId(actionsForId === id ? null : id)}
              onSelect={onSelect ? () => onSelect(id) : undefined}
              onPin={onPin ? () => (onPin(id), closeMenu()) : undefined}
              onRename={onRename ? () => (onRename(id, title), closeMenu()) : undefined}
              onDelete={
                onRequestDelete ? () => (onRequestDelete(id, title), closeMenu()) : undefined
              }
              tokens={tokens}
              theme={theme}
            />
          );
        })
      )}
    </box>
  );
}
