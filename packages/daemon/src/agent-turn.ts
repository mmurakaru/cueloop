/** A harness turn distinguishes initialization cancellation from a running stop request. */
export type AgentTurn =
  | { kind: "idle" }
  | { kind: "starting"; cancelled: boolean }
  | { kind: "running" }
  | { kind: "stopping" };

/** Lifecycle events are independent of the harness wire protocol. */
export type AgentTurnEvent = "start" | "ready" | "stop" | "finished";

/** Start is accepted only at idle; readiness consumes an initialization cancellation. */
export function stepAgentTurn(state: AgentTurn, event: AgentTurnEvent): AgentTurn {
  switch (event) {
    case "start":
      return state.kind === "idle" ? { kind: "starting", cancelled: false } : state;
    case "ready":
      return state.kind === "starting"
        ? state.cancelled
          ? { kind: "idle" }
          : { kind: "running" }
        : state;
    case "stop":
      if (state.kind === "starting") return { kind: "starting", cancelled: true };

      return state.kind === "running" ? { kind: "stopping" } : state;
    case "finished":
      return { kind: "idle" };
  }
}

/** Pending stop requests suppress later tool and permission events from this turn. */
export function agentTurnCancelled(state: AgentTurn): boolean {
  return state.kind === "stopping" || (state.kind === "starting" && state.cancelled);
}
