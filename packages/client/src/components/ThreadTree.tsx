/**
 * The sidebar thread tree: a Starred / Projects / Threads listing. Selection stays
 * with the keyboard grammar - the cursor indexes the flat thread order and this
 * component renders the snapshot. A hovered or selected thread reveals a kebab
 * that opens a floating pin / rename / delete menu below the row (so the list
 * never shifts); a long title clips to an ellipsis rather than wrapping. App
 * supplies the surrounding chrome.
 */

import React, { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { useFrameMeasure } from "../use-frame-measure";
import { useRootOverlay } from "./RootOverlay";
import { useMenuControl } from "./menu-control";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";
import { truncateTitle } from "./truncate-title";
import { threadTitle, type InboxRow } from "./session-tree";

export interface ThreadTreeProps {
  rows: InboxRow[];
  cursor: number;
  /** The open thread's id; highlights it instead of the cursor (the left sidebar case). */
  activeId?: string;
  focused?: boolean;
  /** Ids of starred threads; a starred row carries the star glyph and the menu offers Unstar. */
  pinnedIds?: ReadonlySet<string>;
  /** The column width, so titles fade to fit one line. */
  width?: number;
  /** Open a thread by clicking its row (the left sidebar case). */
  onSelect?: (sessionId: string) => void;
  /** Ask to delete a thread (the menu's Delete, wired to the confirm dialog). */
  onRequestDelete?: (id: string, title: string) => void;
  /** Toggle a thread's starred state (the menu's Star/Unstar). */
  onPin?: (id: string) => void;
  /** Rename a thread's title (the menu's Rename). */
  onRename?: (id: string, title: string) => void;
  theme?: Theme;
}

const MENU_WIDTH = 12;

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
  const item = (label: string, color: string, onPick?: () => void): React.ReactNode =>
    onPick !== undefined ? (
      <box onMouseUp={onPick} style={{ paddingLeft: 1, paddingRight: 1 }}>
        <text fg={color}>{label}</text>
      </box>
    ) : null;

  return (
    <box
      onMouseUp={(event) => event.stopPropagation()}
      style={{
        width: MENU_WIDTH,
        flexDirection: "column",
        border: true,
        borderStyle: "single",
        borderColor: tokens.border,
        backgroundColor: tokens.elevated,
      }}
    >
      {item(pinned ? "unstar" : "star", tokens.text, onPin)}
      {item("rename", tokens.text, onRename)}
      {item("delete", tokens.red, onDelete)}
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
  const rowRef = useRef<BoxRenderable | null>(null);
  const { setOverlay, clearOverlay } = useRootOverlay();
  const anchor = useFrameMeasure(
    () => ({
      x: rowRef.current?.x ?? 0,
      y: rowRef.current?.y ?? 0,
      width: rowRef.current?.width ?? 0,
    }),
    (left, right) => left.x === right.x && left.y === right.y && left.width === right.width,
    { x: 0, y: 0, width: 0 },
    menuOpen,
  );
  const clippedTitle = truncateTitle(title, titleWidth);
  const hasActions =
    props.onPin !== undefined || props.onRename !== undefined || props.onDelete !== undefined;

  useEffect(() => {
    if (!menuOpen) return;
    // the full-screen box closes the menu on an outside click; the menu drops from under the kebab
    setOverlay(
      "thread-menu",
      <box
        onMouseUp={onToggleMenu}
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}
      >
        <box
          style={{
            position: "absolute",
            top: anchor.y + 1,
            left: Math.max(0, anchor.x + anchor.width - MENU_WIDTH),
          }}
        >
          <ActionsMenu
            pinned={pinned}
            onPin={props.onPin}
            onRename={props.onRename}
            onDelete={props.onDelete}
            tokens={tokens}
          />
        </box>
      </box>,
    );

    return () => clearOverlay("thread-menu");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, anchor, pinned, tokens]);

  return (
    <box style={{ flexDirection: "column" }} onMouseOut={() => setHovered(false)}>
      <box
        ref={rowRef}
        onMouseUp={props.onSelect}
        onMouseOver={() => setHovered(true)}
        style={{
          flexDirection: "row",
          backgroundColor: selected ? tokens.elevated : hovered ? tokens.panel : undefined,
        }}
      >
        <text wrapMode="none">
          <span fg={tokens.textDim}>{pinned ? ` ${NERD.star} ` : "   "}</span>
          <span fg={selected ? tokens.accent : tokens.textMuted}>{clippedTitle}</span>
        </text>
        <box style={{ flexGrow: 1 }} />
        {(hovered || menuOpen) && hasActions ? (
          <IconButton
            glyph={NERD.kebab}
            active={menuOpen}
            onPress={onToggleMenu}
            marginRight={1}
            theme={theme}
          />
        ) : null}
      </box>
    </box>
  );
}

export function ThreadTree({
  rows,
  cursor,
  activeId,
  focused = false,
  pinnedIds,
  width = 30,
  onSelect,
  onRequestDelete,
  onPin,
  onRename,
  theme,
}: ThreadTreeProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const menuControl = useMenuControl();
  // leave room for the 3-char prefix, the border, and the hover kebab so a row
  // never wraps: the title fades to fit whatever is left
  const titleWidth = Math.max(8, width - 9);
  const closeMenu = (): void => menuControl.closeMenu();

  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1 }}>
      {rows.length === 0 ? (
        <text fg={tokens.textDim}>no threads</text>
      ) : (
        rows.map((row, index) => {
          if (row.kind === "section") {
            return (
              <text key={row.id} fg={tokens.textDim} style={{ marginTop: index > 0 ? 1 : 0 }}>
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
              selected={
                focused || activeId === undefined ? row.selectionIndex === cursor : activeId === id
              }
              pinned={pinnedIds?.has(id) ?? false}
              titleWidth={titleWidth}
              menuOpen={menuControl.openMenuId === `thread:${id}`}
              onToggleMenu={() => menuControl.toggleMenu(`thread:${id}`)}
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
