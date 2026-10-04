import type { Anchor } from "./types";

/** An agent message keeps its identity after streaming and across reconnects. */
export interface AgentMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  complete: boolean;
  revision: number;
}

/** Tool activity belongs to a turn; its output is bounded by the daemon. */
export interface AgentTool {
  id: string;
  turnId: string;
  title: string;
  kind: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  output: string;
  locations: { path: string; line?: number }[];
}

/** Agent feedback targets a completed message, never a changing stream. */
export interface AgentComment {
  id: string;
  messageId: string;
  anchor: Anchor;
  body: string;
  sent: boolean;
  replyTo?: string;
}

/** Permission options come from the active agent request, not client defaults. */
export interface AgentPermission {
  id: string;
  title: string;
  options: { optionId: string; name: string; kind: string }[];
}

/** Agent lifecycle state distinguishes a waiting permission from an active turn. */
export type AgentPhase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "permission"; permission: AgentPermission }
  | { kind: "failed"; error: string };

/** A thread agent transcript is separate from the artifact and its revision history. */
export interface ThreadAgentState {
  threadId: string;
  /** Session identity is bound to its adapter; another harness cannot resume it. */
  harness?: { id: string; label: string; sessionId?: string };
  phase: AgentPhase;
  messages: AgentMessage[];
  tools: AgentTool[];
  comments: AgentComment[];
}
