import { loadConfig } from "@cueloop/client/config";
import { resolveWorkspaceRoot } from "@cueloop/daemon/thread-review";

export async function syncCommand(arguments_: string[]): Promise<number> {
  const repoRoot = await resolveWorkspaceRoot();

  if (!loadConfig({ repoRoot }).experimental.sync) {
    throw new Error("Multiplayer sync is experimental; enable it in Settings > Experimental");
  }

  if (["import", "resume", "pending", "retry", "discard"].includes(arguments_[0] ?? "")) {
    const { syncThreadImportCommand } = await import("./sync-thread-import-command");

    return syncThreadImportCommand(arguments_);
  }

  const { runSyncCli } = await import("@cueloop/sync/cli");

  const outcome = await runSyncCli(arguments_, {
    renderTextEditor: async (session) => {
      const { runSyncTextEditor } = await import("@cueloop/client/sync-editor");

      return runSyncTextEditor(session, { repoRoot });
    },
  });

  if (!arguments_.length || arguments_.includes("--help")) {
    process.stdout.write(
      "\nThread commands: import <thread>, resume <thread>, pending <thread>, retry <thread> <draft>, discard <thread> <draft>\n",
    );
  }

  return outcome;
}
