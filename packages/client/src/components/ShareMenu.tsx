/**
 * The header share control: a word-button that opens a small popover offering a
 * public link (publish to anyone with the link) or a private link (identity-gated,
 * manage-access lands with the allowlist slice). One menu is open at a time.
 */

import React, { useEffect, useRef, useState } from "react";
import type { BoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { Theme } from "../theme";
import { Button } from "./primitives/Button";
import { useMenuControl } from "./menu-control";
import { useRootOverlay } from "./RootOverlay";
import { useFrameMeasure } from "../use-frame-measure";

const SHARE_MENU_ID = "share";
const SHARE_MENU_WIDTH = 18;

type ShareChoice = "public" | "private";

interface ShareChoiceRow {
  choice: ShareChoice;
  label: string;
}

const SHARE_CHOICES: ShareChoiceRow[] = [
  { choice: "public", label: "public link" },
  { choice: "private", label: "private link" },
];

function ShareMenuPanel({
  selectedIndex,
  onPick,
  tokens,
}: {
  selectedIndex: number;
  onPick: (choice: ShareChoice) => void;
  tokens: Theme;
}): React.ReactNode {
  return (
    <box
      onMouseUp={(event) => event.stopPropagation()}
      style={{
        width: SHARE_MENU_WIDTH,
        flexDirection: "column",
        borderStyle: "single",
        borderColor: tokens.border,
        backgroundColor: tokens.elevated,
      }}
    >
      {SHARE_CHOICES.map((row, index) => (
        <box
          key={row.choice}
          onMouseUp={() => onPick(row.choice)}
          style={{ flexDirection: "row", paddingLeft: 1, paddingRight: 1 }}
        >
          <text fg={index === selectedIndex ? tokens.accent : tokens.text}>
            {index === selectedIndex ? "› " : "  "}
            {row.label}
          </text>
        </box>
      ))}
    </box>
  );
}

export function ShareMenu({
  onPublicShare,
  onPrivateShare,
  theme,
}: {
  /** Publish a public link and copy the connection line, exactly as the header share did before. */
  onPublicShare: () => void;
  /** Open the private-share manage-access surface (allowlist slice fills this in). */
  onPrivateShare: () => void;
  theme: Theme;
}): React.ReactNode {
  const menuControl = useMenuControl();
  const { setOverlay, clearOverlay } = useRootOverlay();
  const menuOpen = menuControl.openMenuId === SHARE_MENU_ID;
  const anchorRef = useRef<BoxRenderable | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const anchor = useFrameMeasure(
    () => ({
      x: anchorRef.current?.x ?? 0,
      y: anchorRef.current?.y ?? 0,
      width: anchorRef.current?.width ?? 0,
    }),
    (left, right) => left.x === right.x && left.y === right.y && left.width === right.width,
    { x: 0, y: 0, width: 0 },
    menuOpen,
  );

  const pick = (choice: ShareChoice): void => {
    menuControl.closeMenu();
    if (choice === "public") onPublicShare();
    else onPrivateShare();
  };

  useKeyboard((key) => {
    if (!menuOpen) return;
    if (key.name === "escape") return menuControl.closeMenu();
    if (key.name === "down" || key.name === "j")
      return setSelectedIndex((index) => Math.min(SHARE_CHOICES.length - 1, index + 1));
    if (key.name === "up" || key.name === "k")
      return setSelectedIndex((index) => Math.max(0, index - 1));
    if (key.name === "return") pick(SHARE_CHOICES[selectedIndex]!.choice);
  });

  useEffect(() => {
    if (!menuOpen) {
      setSelectedIndex(0);

      return;
    }
    setOverlay(
      "share-menu",
      <box
        onMouseUp={menuControl.closeMenu}
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }}
      >
        <box
          style={{
            position: "absolute",
            top: anchor.y + 1,
            left: Math.max(0, anchor.x + anchor.width - SHARE_MENU_WIDTH),
          }}
        >
          <ShareMenuPanel selectedIndex={selectedIndex} onPick={pick} tokens={theme} />
        </box>
      </box>,
    );

    return () => clearOverlay("share-menu");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, anchor, selectedIndex, theme]);

  return (
    <box ref={anchorRef}>
      <Button onPress={() => menuControl.toggleMenu(SHARE_MENU_ID)} theme={theme}>
        {" share "}
      </Button>
    </box>
  );
}
