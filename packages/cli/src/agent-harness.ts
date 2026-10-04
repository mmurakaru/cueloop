import { createFxHarness } from "@cueloop/adapters/fx/harness";
import type { AgentHarnessAdapter } from "@cueloop/schema";

/** Select a locally installed harness; unsupported providers fail before a daemon starts. */
export function configuredAgentHarness(): AgentHarnessAdapter | undefined {
  if (process.env.CUELOOP_AGENT_THREADS !== "1" && process.env.CUELOOP_FX_THREAD !== "1")
    return undefined;
  const id = process.env.CUELOOP_AGENT_HARNESS ?? "fx";

  if (id !== "fx") throw new Error(`Thread agent harness is not installed: ${id}`);

  return createFxHarness({ command: [process.env.CUELOOP_FX_EXECUTABLE ?? "fx", "acp"] });
}
