// The Welcome body: the disposable default tab's contents in the Changes panel,
// shown when nothing else is open. Points at where to start, the docs, and what
// shipped in this build. The tab chrome (label + close) lives in the panel header.

import React from "react";
import type { Theme } from "../theme";

const DOCS_URL = "www.cueloop.dev";

export interface WelcomeSurfaceProps {
  version: string;
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

export function WelcomeSurface({ version, theme }: WelcomeSurfaceProps): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingTop: 1 }}>
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
  );
}
