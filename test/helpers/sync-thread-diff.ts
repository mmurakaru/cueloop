import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Thread } from "@cueloop/schema";
import type { DaemonClient, SyncThreadConnection } from "@cueloop/daemon/client";
import { createTestGitRepo } from "./git-repo";

export async function runTestSyncDiffReview(options: {
  client: DaemonClient;
  connection: Omit<SyncThreadConnection, "recordIdentifier">;
  inspect(thread: Thread): void;
}) {
  const repository = createTestGitRepo([
    { path: "owner.txt", before: "before\n", after: "first owner diff\n" },
  ]);

  try {
    const initialDiff = await repository.diff();
    const diffThread = await options.client.sessionCreate(
      { repoRoot: repository.dir, branch: "main" },
      {
        type: "diff",
        content: initialDiff.patch,
        files: initialDiff.files,
        meta: { title: "Owner-local capture" },
      },
    );

    await options.client.sessionSyncImport(diffThread.id, options.connection);
    await options.client.subscribe();
    const refreshed = Promise.withResolvers<void>();
    const connection = options.client;
    const unsubscribe = options.client.onEvent((event) => {
      if (event.sessionId !== diffThread.id || event.event !== "session.updated") return;

      void connection
        .sessionGet(diffThread.id)
        .then((current) => {
          if (current.artifact.content.includes("second owner diff")) refreshed.resolve();
        })
        .catch(refreshed.reject);
    });
    const timer = setTimeout(
      () =>
        refreshed.reject(
          new Error("Imported diff did not receive its committed owner-local capture"),
        ),
      30000,
    );

    try {
      writeFileSync(join(repository.dir, "owner.txt"), "second owner diff\n");
      await options.client.sessionRefreshDiff(diffThread.id);
      await refreshed.promise;
      options.inspect(await options.client.sessionGet(diffThread.id));
    } finally {
      clearTimeout(timer);
      unsubscribe();
      await options.client.sessionDelete(diffThread.id);
    }
  } finally {
    repository.cleanup();
  }
}
