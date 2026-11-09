import { loadConfig } from "@cueloop/client/config";

export async function syncCommand(arguments_: string[]): Promise<number> {
  if (!loadConfig({ repoRoot: process.cwd() }).experimental.sync) {
    throw new Error("Multiplayer sync is experimental; enable it in Settings > Experimental");
  }

  const { runSyncCli } = await import("@cueloop/sync/cli");

  return runSyncCli(arguments_);
}
