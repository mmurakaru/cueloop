// A workbench panel: one full-height grid column with a file-tab header cell on
// top and a body below. The header row carries the tabs on the left and optional
// controls on the right, with a brand-accent underline that reads as the active
// panel. The column's side border makes the divider run from the very top.

import React, { useState } from "react";
import type { Theme } from "../theme";
import { NERD } from "./primitives/icons";

export interface FileTabProps {
  label: string;
  active?: boolean;
  /** When set, a close control reveals on hover (a disposable tab). */
  onClose?: () => void;
  theme?: Theme;
}

/** A file tab: the label in the accent when active, with a hover-revealed close. */
export function FileTab({ label, active, onClose, theme }: FileTabProps): React.ReactNode {
  const [hovered, setHovered] = useState(false);

  return (
    <box
      style={{ flexDirection: "row", paddingRight: 1 }}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <text fg={active ? theme?.accent : theme?.textDim}>{label}</text>
      {onClose ? (
        <box onMouseUp={onClose} style={{ paddingLeft: 1 }}>
          <text fg={theme?.textDim}>{hovered ? NERD.close : " "}</text>
        </box>
      ) : null}
    </box>
  );
}

export interface PanelColumnProps {
  /** Fixed column width; omit for the flex-growing center panel. */
  width?: number;
  /** Draw the divider on this side (the sidebar borders right, the rest border left). */
  border?: "left" | "right";
  /** Tabs and controls for the header cell. */
  header: React.ReactNode;
  /** Right-aligned header controls (toggles, search). */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  theme?: Theme;
}

export function PanelColumn({
  width,
  border,
  header,
  headerRight,
  children,
  theme,
}: PanelColumnProps): React.ReactNode {
  return (
    <box
      style={{
        width,
        flexGrow: width === undefined ? 1 : undefined,
        flexDirection: "column",
        borderStyle: "single",
        border: border ? [border] : [],
        borderColor: theme?.border,
      }}
    >
      <box
        style={{
          flexDirection: "row",
          height: 2,
          paddingLeft: 1,
          backgroundColor: theme?.panel,
          borderStyle: "single",
          border: ["bottom"],
          borderColor: theme?.accent,
        }}
      >
        {header}
        <box style={{ flexGrow: 1 }} />
        {headerRight}
      </box>
      <box style={{ flexGrow: 1, flexDirection: "column" }}>{children}</box>
    </box>
  );
}
