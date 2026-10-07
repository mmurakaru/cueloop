import type { Thread, ThreadAgentState } from "@cueloop/schema";

/** Handoff transfers continuation context, never provider credentials or private session files. */
export function harnessHandoffPrompt(thread: Thread, state: ThreadAgentState): string {
  return `Prepare a continuation document for another agent taking over this Thread.
Do not execute tools or change files. Return only the handoff text.
Include the current goal, decisions, completed work, outstanding work, constraints, and suggested skills.
Reference existing artifacts by path or URL instead of duplicating them.
Redact credentials, passwords, and personal information.
Thread: ${thread.id}
Workspace: ${thread.workspace.repoRoot}
Reviewed artifact:
${thread.artifact.content.slice(0, 32768)}
Pending continuation context:
${state.continuation ?? ""}
Recent conversation:
${state.messages
  .filter((message) => message.complete)
  .map((message) => `${message.role}: ${message.text}`)
  .join("\n")
  .slice(-65536)}`;
}

/** The receiving agent treats the handoff as context rather than a fresh user instruction. */
export function harnessContinuationPrompt(handoff: string, prompt: string): string {
  return `Continuation context from the previous harness:\n${handoff}\n\nCurrent request:\n${prompt}`;
}
