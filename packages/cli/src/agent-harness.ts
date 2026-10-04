import { createFxHarness } from "@cueloop/adapters/fx/harness";
import { loadConfig } from "@cueloop/client/config";
import type { AgentHarnessAdapter } from "@cueloop/schema";

/** Select a locally installed harness; unsupported providers fail before a daemon starts. */
export function configuredAgentHarness(): AgentHarnessAdapter | undefined {
  const id = process.env.CUELOOP_AGENT_HARNESS ?? "fx";

  if (id !== "fx") throw new Error(`Thread agent harness is not installed: ${id}`);

  return createFxHarness({ command: [process.env.CUELOOP_FX_EXECUTABLE ?? "fx", "acp"] });
}

/** Resolve the experimental Thread agent flag from user and workspace TOML. */
export function threadAgentEnabled(repoRoot: string): boolean {
  return loadConfig({ repoRoot }).experimental.threadAgent;
}
