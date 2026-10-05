import { createPiHarness } from "@cueloop/adapters/pi/durable-harness";
import { cueloopHome } from "@cueloop/daemon";
import { createFxHarness } from "@cueloop/adapters/fx/harness";
import { loadConfig } from "@cueloop/client/config";
import type { AgentHarnessAdapter } from "@cueloop/schema";

/** Select a locally installed harness; unsupported providers fail before a daemon starts. */
export function configuredAgentHarness(): AgentHarnessAdapter | undefined {
  const id = process.env.CUELOOP_AGENT_HARNESS ?? "pi";

  if (id === "pi") return createPiHarness({ home: cueloopHome() });

  if (id !== "fx") throw new Error(`Thread agent harness is not installed: ${id}`);

  return fxHarness();
}

/** Resolve the experimental Thread agent flag from user and workspace TOML. */
export function threadAgentEnabled(repoRoot: string): boolean {
  return loadConfig({ repoRoot }).experimental.threadAgent;
}

export function installedAgentHarnesses() {
  return {
    pi: createPiHarness({ home: cueloopHome() }),
    fx: fxHarness(),
  };
}

function fxHarness(): AgentHarnessAdapter {
  return createFxHarness({ command: [process.env.CUELOOP_FX_EXECUTABLE ?? "fx", "acp"] });
}
