// The thread's bottom band: a header-like bar shown only under the always-visible
// thread column. It carries the repo/branch context on the left and a written,
// clickable "Send message" control on the right.

import React from "react";
import { DARK, type Theme } from "../theme";
import { NERD } from "./primitives/icons";

export interface ThreadFooterProps {
  repo: string;
  branch: string;
  onSubmit?: () => void;
  /** When false the send control dims and does not fire (e.g. an observer). */
  canSubmit?: boolean;
  theme?: Theme;
}

export function ThreadFooter({
  repo,
  branch,
  onSubmit,
  canSubmit = true,
  theme,
}: ThreadFooterProps): React.ReactNode {
  const tokens = theme ?? DARK;

  return (
    <box
      style={{
        flexDirection: "row",
        height: 1,
        alignItems: "center",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: tokens.panel,
      }}
    >
      <text>
        <span fg={tokens.blue}>{`${NERD.folderClosed} `}</span>
        <span fg={tokens.textMuted}>{repo}</span>
        <span fg={tokens.textDim}>{` / ${branch}`}</span>
      </text>
      <box style={{ flexGrow: 1 }} />
      <box onMouseUp={canSubmit ? onSubmit : undefined}>
        <text fg={canSubmit ? tokens.accent : tokens.textDim}>send message</text>
      </box>
    </box>
  );
}
