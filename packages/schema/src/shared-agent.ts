import type { Thread } from "./types";
import type { AgentComment, AgentPromptRequest, ThreadAgentState } from "./thread-agent";

/** Gateway requests retain their identity until the owner durably accepts them. */
export interface SharedAgentRequest {
  author: string;
  params: AgentPromptRequest & { operationId: string };
  comment?: AgentComment;
}

/** The owner receives a current artifact and the unacknowledged request outbox. */
export type SharedAgentFrame =
  | { type: "hello"; shareId: string }
  | { type: "requests"; thread: Thread; requests: SharedAgentRequest[] }
  | { type: "state"; state: ThreadAgentState; accepted?: string[] };
