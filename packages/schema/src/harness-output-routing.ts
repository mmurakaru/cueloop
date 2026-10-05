import type { AgentHarnessDiagnostic, AgentHarnessEvent } from "./agent-harness";

type RoutedHarnessOutput =
  | { destination: "diagnostics"; event: AgentHarnessDiagnostic }
  | { destination: "thread"; event: Exclude<AgentHarnessEvent, AgentHarnessDiagnostic> };

/** Route normalized harness output by provenance; assistant wording never changes its destination. */
export function routeHarnessOutput(event: AgentHarnessEvent): RoutedHarnessOutput {
  if (event.kind === "diagnostic") return { destination: "diagnostics", event };

  return { destination: "thread", event };
}
