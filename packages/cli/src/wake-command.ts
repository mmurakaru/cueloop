/**
 * Legacy Codex wake command. The Codex plugin replaces this detached waiter.
 * Claude Code and pi already inject Messages through native adapters.
 */

import { parseArgs, stringFlag } from "./args";

export async function wakeCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const sessionId = positional[0];

  if (sessionId === undefined) {
    console.error("usage: cueloop wake <session-id> --harness codex --thread <codex-thread-id>");

    return 2;
  }
  const harness = stringFlag(flags, "harness");

  if (harness === "codex") {
    const threadId = stringFlag(flags, "thread");

    if (threadId === undefined) {
      console.error("cueloop wake --harness codex needs --thread <codex-thread-id>");

      return 2;
    }
    const { runCodexWake } = await import("@cueloop/adapters/codex/wake");

    return (await runCodexWake(sessionId, threadId)) ? 0 : 1;
  }
  console.error("cueloop wake requires --harness codex; Claude Code uses its native Mod");

  return 2;
}
