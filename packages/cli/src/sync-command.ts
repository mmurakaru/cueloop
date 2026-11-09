import { loadConfig } from "@cueloop/client/config";
import { resolveWorkspaceRoot } from "@cueloop/daemon/thread-review";

export async function syncCommand(arguments_: string[]): Promise<number> {
  const repoRoot = await resolveWorkspaceRoot();

  if (!loadConfig({ repoRoot }).experimental.sync) {
    throw new Error("Multiplayer sync is experimental; enable it in Settings > Experimental");
  }

  const { runSyncCli } = await import("@cueloop/sync/cli");

  return runSyncCli(arguments_);
}
