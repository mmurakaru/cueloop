// App shell: a grid of pane columns. Each column stacks a header cell over its body; the vertical
// rules run full height (through the header), and each header cell's bottom rule joins into one
// horizontal line across the columns. Rules only - no enclosing frames.

import React from "react";
import { DARK, type Theme } from "../theme";
import type { BorderSides } from "@opentui/core";

export interface AppShellProps {
  headerHeight?: number;
  sidebar?: React.ReactNode;
  sidebarHeader?: React.ReactNode;
  sidebarWidth?: number;
  main: React.ReactNode;
  mainHeader?: React.ReactNode;
  inspector?: React.ReactNode;
  inspectorHeader?: React.ReactNode;
  inspectorWidth?: number;
  footer?: React.ReactNode;
  theme?: Theme;
}

interface PaneColumnProps {
  width?: number;
  grow?: boolean;
  side?: BorderSides;
  header: React.ReactNode;
  body: React.ReactNode;
  headerHeight: number;
  theme: Theme;
}

function PaneColumn({
  width,
  grow,
  side,
  header,
  body,
  headerHeight,
  theme,
}: PaneColumnProps): React.ReactNode {
  return (
    <box
      style={{
        flexDirection: "column",
        ...(grow ? { flexGrow: 1 } : { width }),
        borderStyle: "single",
        border: side ? [side] : [],
        borderColor: theme.border,
      }}
    >
      <box
        style={{
          height: headerHeight,
          borderStyle: "single",
          border: ["bottom"],
          borderColor: theme.border,
        }}
      >
        {header}
      </box>
      <box style={{ flexGrow: 1 }}>{body}</box>
    </box>
  );
}

export function AppShell({
  headerHeight = 3,
  sidebar,
  sidebarHeader,
  sidebarWidth = 28,
  main,
  mainHeader,
  inspector,
  inspectorHeader,
  inspectorWidth = 40,
  footer,
  theme,
}: AppShellProps): React.ReactNode {
  const tokens = theme ?? DARK;

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: tokens.background,
      }}
    >
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        {sidebar !== undefined ? (
          <PaneColumn
            width={sidebarWidth}
            side="right"
            header={sidebarHeader}
            body={sidebar}
            headerHeight={headerHeight}
            theme={tokens}
          />
        ) : null}
        <PaneColumn
          grow
          header={mainHeader}
          body={main}
          headerHeight={headerHeight}
          theme={tokens}
        />
        {inspector !== undefined ? (
          <PaneColumn
            width={inspectorWidth}
            side="left"
            header={inspectorHeader}
            body={inspector}
            headerHeight={headerHeight}
            theme={tokens}
          />
        ) : null}
      </box>
      {footer !== undefined ? (
        <box style={{ borderStyle: "single", border: ["top"], borderColor: tokens.border }}>
          {footer}
        </box>
      ) : null}
    </box>
  );
}
