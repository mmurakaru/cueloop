import type { Thread, ThreadAgentState } from "@cueloop/schema";

function projectSyncThreadAgent(state: ThreadAgentState): ThreadAgentState {
  const {
    promptOperations: _privateReceipts,
    handoff: _privateHandoff,
    continuation: _privateContinuation,
    configOptions: _privateConfiguration,
    ...projection
  } = state;

  if (projection.harness)
    projection.harness = { id: projection.harness.id, label: projection.harness.label };

  if (projection.submissions)
    projection.submissions = projection.submissions.map(
      ({ harnessPrompt: _privatePrompt, attemptId: _privateAttempt, ...submission }) => submission,
    );

  if (projection.phase.kind === "failed")
    projection.phase = { kind: "failed", error: "Owner execution failed" };

  if (projection.phase.kind === "permission")
    projection.phase = {
      kind: "permission",
      permission: {
        id: projection.phase.permission.id,
        title: "Owner permission required",
        options: [],
      },
    };

  return projection;
}

/** Native receipts, share administration, and execution recovery stay in the owner-only state. */
export function projectSyncThreadForCollaborators(thread: Thread): Thread {
  const { messageOperations: _privateReceipts, shares: _privateShares, ...projection } = thread;

  if (projection.agentSnapshot)
    projection.agentSnapshot = projectSyncThreadAgent(projection.agentSnapshot);

  return projection;
}
