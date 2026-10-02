/**
 * Horizontal action row: children flow left to right on one row. The classic
 * home of Button groups (Save/Cancel, Submit/Cancel).
 */

import React from "react";

export interface ToolbarProps {
  children: React.ReactNode;
}

export function Toolbar({ children }: ToolbarProps): React.ReactNode {
  return <box style={{ flexDirection: "row", height: 1 }}>{children}</box>;
}
