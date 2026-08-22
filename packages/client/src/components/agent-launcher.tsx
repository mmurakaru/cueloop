/**
 * The Agent rail launcher: bring-your-own review harness. Branded claude code /
 * pi / codex cards that, on click, run that harness in a herdr split beside the
 * review (see launchHarnessInSplit) so a reviewer can ask an agent about the plan
 * without leaving the tab. A plan-context toggle seeds a briefing into the split.
 */

import React, { useState } from "react";
import type { ReviewSession } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { FRAME_BORDER_STYLE } from "./primitives/frame";

/** One launchable harness: its rail command and the real logo, rendered as colored rows. */
export interface HarnessLauncher {
  id: string;
  name: string;
  /** The shell command that starts the harness, run in the split. */
  command: string;
  /** Brand color for the mark. */
  color: string;
  /** Multi-row mark rendered from the real logo. */
  logo: string[];
}

/** Claude Code's brand coral - not a theme token, the mark keeps its own color. */
const CLAUDE_CORAL = "#CC785C";

/** The bring-your-own harnesses, with their real marks (finalized in the prototype). */
export const HARNESS_LAUNCHERS: HarnessLauncher[] = [
  {
    id: "claude",
    name: "claude code",
    command: "cc",
    color: CLAUDE_CORAL,
    logo: [" ▛████▜", "▜██████▛", " ▝▝  ▝▝"],
  },
  { id: "pi", name: "pi", command: "pi", color: "#e4e6ec", logo: ["███ ", "█ █ ", "██ █", "█  █"] },
  {
    id: "codex",
    name: "codex",
    command: "codex",
    color: "#e4e6ec",
    logo: ["┌───┐", "│>_ │", "└───┘"],
  },
];

/** The briefing typed into a launched harness when the plan-context toggle is on. */
export function planHandoffBriefing(sessionId: string): string {
  return `Review this cueloop plan: read it with 'cueloop session get ${sessionId}', then comment with 'cueloop session annotate ${sessionId} --author me --quote "<exact span>" --body "<comment>"'. Do not rewrite the plan.`;
}

function LogoMark({ harness }: { harness: HarnessLauncher }): React.ReactNode {
  return (
    <box style={{ width: 9, flexShrink: 0, flexDirection: "column", alignItems: "flex-start" }}>
      {harness.logo.map((row) => (
        <text key={row} fg={harness.color}>
          {row}
        </text>
      ))}
    </box>
  );
}

export interface AgentLauncherProps {
  session: ReviewSession;
  /** Launch a harness in the rail; seedText is the plan-context briefing when the toggle is on. */
  onLaunchHarness: (command: string, seedText?: string) => void;
  theme?: Theme;
}

/**
 * The Agent tab body: branded launcher cards plus a plan-context toggle. Replaces
 * the old dead agent/status/revision placeholder (now a dim footer line).
 */
export function AgentLauncher({
  session,
  onLaunchHarness,
  theme,
}: AgentLauncherProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const [seedContext, setSeedContext] = useState(true);
  const launch = (harness: HarnessLauncher): void =>
    onLaunchHarness(harness.command, seedContext ? planHandoffBriefing(session.id) : undefined);
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <text fg={tokens.text}>Ask an agent about this plan</text>
      <box style={{ height: 1 }} />
      {HARNESS_LAUNCHERS.map((harness) => (
        <box
          key={harness.id}
          style={{
            flexDirection: "row",
            height: harness.logo.length + 2,
            border: true,
            borderStyle: FRAME_BORDER_STYLE,
            backgroundColor: "transparent",
            borderColor: tokens.border,
            marginBottom: 1,
            paddingLeft: 1,
            paddingRight: 1,
          }}
          onMouseUp={() => launch(harness)}
        >
          <LogoMark harness={harness} />
          <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1 }}>
            <text fg={tokens.textMuted}>{harness.name}</text>
            <text fg={tokens.textDim}>launch in rail ▸</text>
          </box>
        </box>
      ))}
      <box style={{ flexDirection: "row" }} onMouseUp={() => setSeedContext((on) => !on)}>
        <text fg={tokens.textDim}>plan context: </text>
        <text fg={tokens.accent}>{seedContext ? "seed the plan ▸" : "none ▸"}</text>
      </box>
      <box style={{ flexGrow: 1 }} />
      <text fg={tokens.textDim}>
        {session.artifact.meta.agent ?? "unknown"} · {session.status} · rev{" "}
        {session.revisions.length}
      </text>
    </box>
  );
}
