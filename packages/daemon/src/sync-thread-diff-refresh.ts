import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "@cueloop/schema";
import { DaemonCore, type SyncThreadDiffLifecycle } from "./api";
import { MemoryThreadStore } from "./store";

/** Capture runs on the repository owner; the authority receives only a version-bound validated snapshot. */
export function createSyncThreadDiffLifecycle(options: {
  read(threadIdentifier: string): { thread: Thread; version: number };
  commit(thread: Thread, version: number): Promise<void>;
}): SyncThreadDiffLifecycle {
  const generations = new Map<string, number>();

  return {
    async refresh(threadIdentifier) {
      const generation = (generations.get(threadIdentifier) ?? 0) + 1;

      generations.set(threadIdentifier, generation);
      const source = options.read(threadIdentifier);
      const core = new DaemonCore(
        join(tmpdir(), `cueloop-owner-diff-${randomUUID()}`),
        new MemoryThreadStore([source.thread]),
      );
      let updated = false;

      core.onEvent(() => {
        updated = true;
      });

      try {
        const result = await core.sessionRefreshDiff(threadIdentifier);

        if (!updated || generations.get(threadIdentifier) !== generation) return { changed: false };

        await options.commit(core.sessionGet(threadIdentifier), source.version);

        return result;
      } finally {
        core.dispose();
      }
    },
    async markAvailable(threadIdentifier, references) {
      const source = options.read(threadIdentifier);
      const metadata = source.thread.artifact.meta;

      if (
        source.thread.status !== "pending" ||
        metadata.pr === undefined ||
        (metadata.prBaseSha === references.baseSha && metadata.prHeadSha === references.headSha)
      )
        return;

      source.thread.artifact.meta = {
        ...metadata,
        prRefreshBaseSha: references.baseSha,
        prRefreshHeadSha: references.headSha,
      };
      await options.commit(source.thread, source.version);
    },
  };
}
