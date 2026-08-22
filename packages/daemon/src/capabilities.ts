/**
 * Daemon role capabilities: which socket methods a connection may call. The
 * owner (the local planner) may call everything; a collaborator or a review-side
 * agent is capped to reading the session and adding annotations, so a bring-your-
 * own agent literally cannot resolve, rewrite, cut, share, or delete (ADR 0009).
 * This is the single source of truth the server dispatch enforces.
 */

export type DaemonRole = "owner" | "collaborator" | "agent";

/** Methods a non-owner role may call: read the session and annotate, plus connection plumbing. */
const NON_OWNER_METHODS = new Set<string>([
  "daemon.ping",
  "daemon.hello",
  "events.subscribe",
  "session.get",
  "session.list",
  "session.wait",
  "session.annotate",
]);

/** Whether `role` may call `method`. The owner may call anything; others are capped to read + annotate. */
export function roleAllowsMethod(role: DaemonRole, method: string): boolean {
  return role === "owner" || NON_OWNER_METHODS.has(method);
}

/** Parse an untrusted role string, defaulting unknown values to the capped "agent". */
export function asDaemonRole(value: unknown): DaemonRole {
  return value === "owner" || value === "collaborator" ? value : "agent";
}
