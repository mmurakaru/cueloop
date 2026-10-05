/** Submitted comments stay read-only through queueing, completion, failure, and retry. */
export type AgentSubmissionStatus = "draft" | "queued" | "running" | "completed" | "failed";

/** Submission events never rewrite an accepted input. */
export type AgentSubmissionEvent = "submit" | "start" | "complete" | "fail" | "retry" | "edit";

/** Empty input cannot create a turn; retry is valid only for a failed submission. */
export function stepAgentSubmission(status: "draft", event: "submit", hasInput: true): "queued";
export function stepAgentSubmission(
  status: Exclude<AgentSubmissionStatus, "draft">,
  event: AgentSubmissionEvent,
  hasInput: boolean,
): Exclude<AgentSubmissionStatus, "draft">;
export function stepAgentSubmission(
  status: AgentSubmissionStatus,
  event: AgentSubmissionEvent,
  hasInput: boolean,
): AgentSubmissionStatus;
export function stepAgentSubmission(
  status: AgentSubmissionStatus,
  event: AgentSubmissionEvent,
  hasInput: boolean,
): AgentSubmissionStatus {
  switch (event) {
    case "submit":
      return status === "draft" && hasInput ? "queued" : status;
    case "start":
      return status === "queued" ? "running" : status;
    case "complete":
      return status === "running" ? "completed" : status;
    case "fail":
      return status === "running" ? "failed" : status;
    case "retry":
      return status === "failed" ? "queued" : status;
    case "edit":
      return status;
  }
}
