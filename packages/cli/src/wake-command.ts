/**
 * `cueloop wake <session-id>` - the production caller for the non-blocking wake.
 * A detached child of a coding-agent session parks on the review's verdict and
 * injects it back into that same live session when the human decides, so the
 * agent resumes itself without a blocked, pinned tool call. The plan skill (and
 * the Claude Code hook's non-blocking path) spawn this right after a
 * non-blocking review:  `cueloop wake <session-id> &`.
 *
 * Claude Code is the default and reads its inbox socket from the environment.
 * Codex needs its running thread id (`--harness codex --thread <thread-id>`).
 * pi wakes in-process from its extension and does not use this command.
 */

import { parseArgs, stringFlag } from "./args";

export async function wakeCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const sessionId = positional[0];

  if (sessionId === undefined) {
    console.error(
      "usage: cueloop wake <session-id> [--harness claude-code|codex] [--thread <codex-thread-id>]",
    );

    return 2;
  }
  const harness = stringFlag(flags, "harness") ?? "claude-code";

  if (harness === "codex") {
    const threadId = stringFlag(flags, "thread");

    if (threadId === undefined) {
      console.error("cueloop wake --harness codex needs --thread <codex-thread-id>");

      return 2;
    }
    const { runCodexWake } = await import("@cueloop/adapters/codex/wake");

    return (await runCodexWake(sessionId, threadId)) ? 0 : 1;
  }
  const { runInboxWake } = await import("@cueloop/adapters/claude-code/wake");

  return (await runInboxWake(sessionId)) ? 0 : 1;
}
