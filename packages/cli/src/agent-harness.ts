import { createPiHarness } from "@cueloop/adapters/pi/durable-harness";
import { cueloopHome } from "@cueloop/daemon";
import { createThreadHarness } from "@cueloop/adapters/thread-harness";
import { createFxHarness } from "@cueloop/adapters/fx/harness";
import { loadConfig } from "@cueloop/client/config";
import type { AgentHarnessAdapter } from "@cueloop/schema";

/** Explicit startup selection overrides the owner and workspace preferences. */
export function configuredAgentHarnessId(repoRoot?: string): "pi" | "fx" {
  const id = process.env.CUELOOP_AGENT_HARNESS ?? loadConfig({ repoRoot }).thread.harness;

  if (id !== "pi" && id !== "fx") throw new Error(`Thread agent harness is not installed: ${id}`);

  return id;
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
  return createThreadHarness({
    home: cueloopHome(),
    backend: createFxHarness({ command: [process.env.CUELOOP_FX_EXECUTABLE ?? "fx", "acp"] }),
  });
}
