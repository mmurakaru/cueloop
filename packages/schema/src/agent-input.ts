/** A prompt line and a marked-text comment are mutually exclusive input targets. */
export type AgentInputTarget = "prompt" | "comment" | "none";

/** Unmarked artifact text cannot create a comment; the final prompt line never creates one. */
export function agentInputTarget(atPrompt: boolean, hasSelection: boolean): AgentInputTarget {
  if (atPrompt) return "prompt";

  return hasSelection ? "comment" : "none";
}
