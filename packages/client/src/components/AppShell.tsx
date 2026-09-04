// App shell: the outer pane layout - regions divided by single straight rules, not enclosing frames.

import React from "react";
import { DARK, type Theme } from "../theme";

export interface AppShellProps {
  header?: React.ReactNode;
  sidebar?: React.ReactNode;
  sidebarWidth?: number;
  main: React.ReactNode;
  inspector?: React.ReactNode;
  inspectorWidth?: number;
  footer?: React.ReactNode;
  theme?: Theme;
}

export function AppShell({
  header,
  sidebar,
  sidebarWidth = 28,
  main,
  inspector,
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
      {header !== undefined ? <box>{header}</box> : null}
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        {sidebar !== undefined ? (
          <box
            style={{
              width: sidebarWidth,
              borderStyle: "single",
              border: ["right"],
              borderColor: tokens.border,
            }}
          >
            {sidebar}
          </box>
        ) : null}
        <box style={{ flexGrow: 1 }}>{main}</box>
        {inspector !== undefined ? (
          <box
            style={{
              width: inspectorWidth,
              borderStyle: "single",
              border: ["left"],
              borderColor: tokens.border,
            }}
          >
            {inspector}
          </box>
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
