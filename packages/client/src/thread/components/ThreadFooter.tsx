// The thread's bottom band: a header-like bar under the thread column, or the
// Changes column when a zoom drops the thread column. It carries the repo/branch
// context on the left and a written, clickable "Send message (n)" control on the right.

import React, { useRef } from "react";
import type { BoxRenderable } from "@opentui/core";
import { DARK, type Theme } from "../../appearance/theme";
import { useFrameMeasure } from "../../ui/use-frame-measure";
import { truncateTitle } from "../../ui/components/truncate-title";
import { NERD } from "../../ui/components/primitives/icons";

export interface ThreadFooterProps {
  controls?: React.ReactNode;
  repo: string;
  branch: string;
  onSubmit?: () => void;
  canSubmit?: boolean;
  pendingAnnotations?: number;
  theme?: Theme;
}

const ICON_COLUMNS = 2; // folder glyph + its trailing space
const SEPARATOR = " / ";

/** Rows the footer band occupies, so a footer-less sibling pane can offset its centered content to match. */
export const THREAD_FOOTER_HEIGHT = 2;

export function ThreadFooter({
  controls,
  repo,
  branch,
  onSubmit,
  canSubmit = true,
  pendingAnnotations = 0,
  theme,
}: ThreadFooterProps): React.ReactNode {
  const tokens = theme ?? DARK;
  const boxRef = useRef<BoxRenderable | null>(null);
  const width = useFrameMeasure(
    () => boxRef.current?.width ?? 0,
    (left, right) => left === right,
    0,
  );
  const branchBudget = width - ICON_COLUMNS - repo.length - SEPARATOR.length;
  const clippedBranch = width > 0 ? truncateTitle(branch, Math.max(0, branchBudget)) : branch;

  return (
    <box
      style={{
        flexDirection: "row",
        height: THREAD_FOOTER_HEIGHT,
        alignItems: "center",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: tokens.panel,
        borderStyle: "single",
        border: ["top"],
        borderColor: tokens.border,
      }}
    >
      <box ref={boxRef} style={{ flexShrink: 1, minWidth: 0, marginRight: 2 }}>
        <text wrapMode="none">
          <span fg={tokens.blue}>{`${NERD.folderClosed} `}</span>
          <span fg={tokens.textMuted}>{repo}</span>
          <span fg={tokens.textDim}>{`${SEPARATOR}${clippedBranch}`}</span>
        </text>
      </box>
      <box style={{ flexGrow: 1 }} />
      {controls}
      <box onMouseUp={canSubmit ? onSubmit : undefined} style={{ flexShrink: 0 }}>
        <text fg={canSubmit ? tokens.accent : tokens.textDim}>
          {`Send message (${pendingAnnotations})`}
        </text>
      </box>
    </box>
  );
}
