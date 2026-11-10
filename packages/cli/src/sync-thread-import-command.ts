import { DaemonClient } from "@cueloop/daemon/client";
import { parseArgs, stringFlag } from "./args";

export async function syncThreadImportCommand(arguments_: string[]): Promise<number> {
  const { positional, flags } = parseArgs(arguments_);
  const [command, threadIdentifier, draftIdentifier] = positional;

  if (
    !threadIdentifier ||
    (command === "retry" || command === "discard"
      ? positional.length !== 3
      : positional.length !== 2)
  )
    throw new Error(
      "Usage: cueloop sync import <thread> --workspace <id> --authority <origin> --cache <origin> --actor <subject> --token-env <variable>, or cueloop sync resume <thread>",
    );

  const client = await DaemonClient.connect({ autostart: true });

  try {
    if (command === "pending") {
      console.log(JSON.stringify(await client.sessionSyncDrafts(threadIdentifier)));

      return 0;
    }

    if (command === "retry" || command === "discard") {
      if (!draftIdentifier)
        throw new Error("Sync Thread draft operation requires its draft identifier");

      if (command === "retry")
        console.log(
          JSON.stringify(await client.sessionSyncRetry(threadIdentifier, draftIdentifier)),
        );
      else await client.sessionSyncDiscard(threadIdentifier, draftIdentifier);

      return 0;
    }

    if (command === "resume") {
      const thread = await client.sessionSyncResume(threadIdentifier);

      console.log(JSON.stringify({ threadIdentifier: thread.id, status: thread.status }));

      return 0;
    }

    const workspaceIdentifier = stringFlag(flags, "workspace");
    const authorityURL = stringFlag(flags, "authority");
    const cacheURL = stringFlag(flags, "cache");
    const actorIdentifier = stringFlag(flags, "actor");
    const authenticationTokenEnvironment = stringFlag(flags, "token-env");

    if (
      !workspaceIdentifier ||
      !authorityURL ||
      !cacheURL ||
      !actorIdentifier ||
      !authenticationTokenEnvironment
    )
      throw new Error(
        "Sync Thread import requires --workspace, --authority, --cache, --actor, and --token-env; the daemon reads credentials from that environment variable",
      );

    const thread = await client.sessionSyncImport(threadIdentifier, {
      workspaceIdentifier,
      authorityURL,
      cacheURL,
      actorIdentifier,
      authenticationTokenEnvironment,
    });

    console.log(JSON.stringify({ threadIdentifier: thread.id, status: thread.status }));

    return 0;
  } finally {
    client.close();
  }
}
