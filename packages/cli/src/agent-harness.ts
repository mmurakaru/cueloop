import { createPiHarness } from "@cueloop/adapters/pi/durable-harness";
import { cueloopHome } from "@cueloop/daemon";
import { createThreadHarness } from "@cueloop/adapters/thread-harness";
import { createFxHarness } from "@cueloop/adapters/fx/harness";
import { resolveHerdrAcp } from "@cueloop/adapters/herdr-acp";
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

/** The herdr-core ACP backend is opt-in. `CUELOOP_HERDR_ACP=0` forces it off. */
export function herdrAcpEnabled(repoRoot?: string): boolean {
  if (process.env.CUELOOP_HERDR_ACP === "0") return false;

  if (process.env.CUELOOP_HERDR_ACP === "1") return true;

  return loadConfig({ repoRoot }).experimental.herdrAcp;
}

export function installedAgentHarnesses() {
  return {
    pi: createPiHarness({
      home: cueloopHome(),
      defaults: (cwd) => loadConfig({ repoRoot: cwd }).thread.pi,
    }),
    fx: fxHarness(),
  };
}

function fxHarness(): AgentHarnessAdapter {
  const command = [process.env.CUELOOP_FX_EXECUTABLE ?? "fx", "acp"];
  const herdr = resolveHerdrAcp({
    enabled: herdrAcpEnabled(),
    home: cueloopHome(),
    command,
  });

  return createThreadHarness({
    home: cueloopHome(),
    prepareAcp: herdr?.prepare,
    createAcp: herdr?.createAcp,
    onRemove: herdr?.remove,
    backend: createFxHarness({
      command,
      defaults: (cwd) => loadConfig({ repoRoot: cwd }).thread.fx,
      openAcp: herdr?.openAcp,
      existingSession: herdr?.existingSession,
      recoverPrompt: herdr?.recoverPrompt,
    }),
  });
}
