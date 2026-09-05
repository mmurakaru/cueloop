// The empty-state center: a disposable Welcome tab, shown when no thread is open.
// It carries no review state - closing the tab dismisses it to a bare hint, and it
// returns the next time the app opens with nothing selected. Points at where to
// start, the docs, and what shipped in this build.

import React from "react";
import type { Theme } from "../theme";

const DOCS_URL = "www.cueloop.dev";

export interface WelcomeSurfaceProps {
  version: string;
  /** Close the tab; the center falls back to a bare "select a thread" hint. */
  onClose: () => void;
  theme?: Theme;
}

function Section({
  title,
  children,
  theme,
}: {
  title: string;
  children: React.ReactNode;
  theme?: Theme;
}): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", marginTop: 1 }}>
      <text fg={theme?.text}>{title}</text>
      {children}
    </box>
  );
}

export function WelcomeSurface({ version, onClose, theme }: WelcomeSurfaceProps): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box
        style={{
          flexDirection: "row",
          height: 1,
          borderStyle: "single",
          border: ["bottom"],
          borderColor: theme?.border,
        }}
      >
        <box style={{ flexDirection: "row", paddingLeft: 1, paddingRight: 1 }}>
          <text fg={theme?.accent}>Welcome</text>
          <box onMouseUp={onClose} style={{ paddingLeft: 2 }}>
            <text fg={theme?.textDim}>✕</text>
          </box>
        </box>
      </box>
      <box style={{ flexDirection: "column", paddingLeft: 2, paddingTop: 1 }}>
        <text fg={theme?.accent}>Welcome to cueloop</text>
        <text fg={theme?.textDim}>a review loop for coding agents</text>
        <Section title="Start" theme={theme}>
          <text fg={theme?.textDim}>· select a thread on the left</text>
          <text fg={theme?.textDim}>· or run cueloop plan / cueloop diff from a repo</text>
        </Section>
        <Section title="Learn" theme={theme}>
          <text fg={theme?.textDim}>{`· docs        ${DOCS_URL}`}</text>
          <text fg={theme?.textDim}>{`· changelog   ${DOCS_URL}/changelog`}</text>
        </Section>
        <Section title="What's new" theme={theme}>
          <text fg={theme?.textDim}>{`· cueloop v${version}`}</text>
        </Section>
      </box>
    </box>
  );
}
