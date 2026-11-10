import { defineMutatorWithType, defineMutatorsWithType } from "@cueloop/sync/schema";
import { syncThreadOperations } from "./sync-thread-protocol";
import { syncThreadSchema } from "./sync-thread-schema";
import type { SyncThreadContext } from "./sync-thread-queries";

const defineThreadMutator = defineMutatorWithType<typeof syncThreadSchema, SyncThreadContext>();

export const syncThreadMutators = defineMutatorsWithType<typeof syncThreadSchema>()({
  thread: {
    import: defineThreadMutator(syncThreadOperations.import.schema, async ({ tx: transaction }) => {
      if (transaction.location !== "client")
        throw new Error("Sync Thread import requires its authoritative registry");
    }),
    command: defineThreadMutator(
      syncThreadOperations.command.schema,
      async ({ tx: transaction }) => {
        if (transaction.location !== "client")
          throw new Error("Sync Thread commands require their authoritative registry");
      },
    ),
    stagedCommand: defineThreadMutator(
      syncThreadOperations.stagedCommand.schema,
      async ({ tx: transaction }) => {
        if (transaction.location !== "client")
          throw new Error("Sync Thread staged commands require their authoritative registry");
      },
    ),
    editText: defineThreadMutator(
      syncThreadOperations.editText.schema,
      async ({ tx: transaction }) => {
        if (transaction.location !== "client")
          throw new Error("Sync Thread text editing requires its authoritative registry");
      },
    ),
  },
});
