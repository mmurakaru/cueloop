import type { AgentPermission, AgentTool } from "./thread-agent";

/** Harness events carry transcript data without exposing a provider's wire protocol. */
export type AgentHarnessEvent =
  | { kind: "message"; id?: string; text: string }
  | {
      kind: "tool";
      id: string;
      title?: string;
      toolKind?: string;
      status?: AgentTool["status"];
      output?: string;
      locations?: AgentTool["locations"];
    }
  | { kind: "permission"; permission: AgentPermission };

/** A completed turn delivers feedback; stopped or incomplete turns preserve it for retry. */
export interface AgentHarnessResult {
  outcome: "completed" | "cancelled" | "incomplete";
}

/** One harness connection owns initialization, session restore, and its subprocess. */
export interface AgentHarnessConnection {
  start(): Promise<string>;
  prompt(text: string): Promise<AgentHarnessResult>;
  cancel(): void;
  permission(requestId: string, optionId?: string): void;
  close(): void;
}

/** The daemon supplies callbacks and a workspace; executable configuration stays in its adapter. */
export interface AgentHarnessOptions {
  cwd: string;
  sessionId?: string;
  onEvent: (event: AgentHarnessEvent) => void;
  onExit: (error: Error) => void;
}

/** A harness adapter can replace the agent runtime without changing Thread storage or rendering. */
export interface AgentHarnessAdapter {
  id: string;
  label: string;
  connect(options: AgentHarnessOptions): AgentHarnessConnection;
}
