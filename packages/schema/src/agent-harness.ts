import type { AgentPermission, AgentTool, AgentConfigOption } from "./thread-agent";

/** Harness events carry transcript data without exposing a provider's wire protocol. */
export type AgentHarnessEvent =
  | { kind: "message"; id?: string; text: string; replace?: boolean }
  | AgentHarnessDiagnostic
  | {
      kind: "tool";
      id: string;
      title?: string;
      toolKind?: string;
      status?: AgentTool["status"];
      output?: string;
      locations?: AgentTool["locations"];
    }
  | { kind: "permission"; permission: AgentPermission }
  | { kind: "config"; options: AgentConfigOption[] };

/** A completed turn delivers feedback; stopped or incomplete turns preserve it for retry. */
export interface AgentHarnessResult {
  outcome: "completed" | "cancelled" | "incomplete";
}

/** One harness connection owns initialization, session restore, and its subprocess. */
export interface AgentHarnessConnection {
  start(): Promise<string>;
  prompt(text: string, requestId?: string): Promise<AgentHarnessResult>;
  cancel(): void;
  permission(requestId: string, optionId?: string): void;
  close(): void | Promise<void>;
  configure?(id: string, value: string): Promise<void>;
}

/** The daemon supplies callbacks and a workspace; executable configuration stays in its adapter. */
export interface AgentHarnessOptions {
  cwd: string;
  sessionId?: string;
  tools?: AgentHarnessTools;
  onEvent: (event: AgentHarnessEvent) => void;
  onExit: (error: Error) => void;
}

/** A harness adapter can replace the agent runtime without changing Thread storage or rendering. */
export interface AgentHarnessAdapter {
  id: string;
  label: string;
  recovery?: "durable";
  connect(options: AgentHarnessOptions): AgentHarnessConnection;
  remove?(sessionId: string): void | Promise<void>;
}

/** Tools use the daemon API; call arguments and results are serialized JSON validated at the boundary. */
export interface AgentHarnessTools {
  definitions: {
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties: Record<string, { type: string; enum?: string[] }>;
      required: string[];
    };
  }[];
  call(name: string, args: string): Promise<string>;
}

/** Harness diagnostics never enter conversation history; unknown severities retain their spelling. */
export interface AgentHarnessDiagnostic {
  kind: "diagnostic";
  severity: string;
  title: string;
  text: string;
  source: "protocol" | "legacy-text";
}
