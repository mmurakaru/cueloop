/**
 * The Agent rail launcher: bring-your-own review harness. Branded claude code /
 * pi / codex cards that, on click, run that harness in a herdr split beside the
 * review (see launchHarnessInSplit) so a reviewer can ask an agent about the plan
 * without leaving the tab. A plan-context toggle seeds a briefing into the split.
 */

import React, { useEffect, useRef, useState } from "react";
import type { ReviewSession } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { FRAME_BORDER_STYLE } from "./primitives/frame";
import {
  embeddedTerminalAvailable,
  registerTerminalPane,
  type TerminalPaneRenderable,
} from "./terminal-pane";

registerTerminalPane();

/** A running in-tab agent terminal, handed to the app so it can route keys and detach. */
export interface AgentTerminalHandle {
  write: (data: string) => void;
  detach: () => void;
}

/** One launchable harness: its display name and the rail command. */
export interface HarnessLauncher {
  id: string;
  name: string;
  /** The shell command that starts the harness, run in the split. */
  command: string;
}

/** Off-white for the running-terminal header, shared by every harness. */
const HARNESS_HEADER_COLOR = "#e4e6ec";

/** The bring-your-own harnesses, in launch order. The command is the real binary
 *  name spawned on a PTY (not a shell alias, so `claude` - never `cc`, which is
 *  the system C compiler). */
export const HARNESS_LAUNCHERS: HarnessLauncher[] = [
  { id: "claude", name: "Claude Code", command: "claude" },
  { id: "pi", name: "Pi", command: "pi" },
  { id: "codex", name: "OpenAI Codex", command: "codex" },
];

/** The briefing typed into a launched harness when the plan-context toggle is on. */
export function planHandoffBriefing(sessionId: string): string {
  return `Review this cueloop plan: read it with 'cueloop session get ${sessionId}', then comment with 'cueloop session annotate ${sessionId} --author me --quote "<exact span>" --body "<comment>"'. Do not rewrite the plan.`;
}

/** Props for the Agent tab body: the session under review plus the launch callbacks. */
export interface AgentLauncherProps {
  session: ReviewSession;
  /**
   * Fallback launch when no embedded terminal ships for this platform: run the
   * harness in a herdr split. seedText is the plan-context briefing.
   */
  onLaunchHarness: (command: string, seedText?: string) => void;
  /** Notifies the app of the in-tab terminal handle (or null when detached) so it can route keys. */
  onAgentTerminal?: (handle: AgentTerminalHandle | null) => void;
  theme?: Theme;
}

/**
 * The Agent tab body: branded launcher cards plus a plan-context toggle. Replaces
 * the old dead agent/status/revision placeholder (now a dim footer line). When a
 * prebuilt libghostty-vt ships for the platform, a picked harness runs embedded
 * inside this tab; otherwise it falls back to a herdr split.
 */
export function AgentLauncher({
  session,
  onLaunchHarness,
  onAgentTerminal,
  theme,
}: AgentLauncherProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const [seedContext, setSeedContext] = useState(true);
  const [running, setRunning] = useState<{ harness: HarnessLauncher; seed?: string } | null>(null);
  const paneRef = useRef<TerminalPaneRenderable | null>(null);

  const launch = (harness: HarnessLauncher): void => {
    const seed = seedContext ? planHandoffBriefing(session.id) : undefined;
    if (embeddedTerminalAvailable()) setRunning({ harness, seed });
    else onLaunchHarness(harness.command, seed);
  };
  const detach = (): void => {
    // The reconciler's removeChild detaches the pane without destroying it, so
    // kill the child + free the VT here or they leak. shutdown() is idempotent.
    paneRef.current?.shutdown();
    setRunning(null);
  };

  useEffect(() => {
    if (!running) return onAgentTerminal?.(null);
    onAgentTerminal?.({ write: (data) => paneRef.current?.write(data), detach });
    return () => onAgentTerminal?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  if (running) {
    return (
      <box style={{ flexDirection: "column", flexGrow: 1 }}>
        <box style={{ flexDirection: "row" }} onMouseUp={detach}>
          <text fg={HARNESS_HEADER_COLOR}>{running.harness.name}</text>
          <box style={{ flexGrow: 1 }} />
          <text fg={tokens.textDim}>✕ detach</text>
        </box>
        {React.createElement("terminalPane", {
          ref: paneRef,
          command: running.harness.command,
          cwd: session.artifact.meta.cwd ?? process.cwd(),
          seedText: running.seed,
          onExit: detach,
          style: { flexGrow: 1 },
        })}
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      {HARNESS_LAUNCHERS.map((harness) => (
        <box
          key={harness.id}
          style={{
            flexDirection: "row",
            height: 3,
            border: true,
            borderStyle: FRAME_BORDER_STYLE,
            backgroundColor: "transparent",
            borderColor: tokens.border,
            paddingLeft: 1,
            paddingRight: 1,
          }}
          onMouseUp={() => launch(harness)}
        >
          <text fg={tokens.textMuted}>{harness.name}</text>
        </box>
      ))}
      <box style={{ flexDirection: "row" }} onMouseUp={() => setSeedContext((on) => !on)}>
        <text fg={tokens.textDim}>plan context: </text>
        <text fg={tokens.accent}>{seedContext ? "seed the plan" : "none"}</text>
      </box>
    </box>
  );
}
