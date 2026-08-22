/**
 * `cueloop actions list [--session <id>]` - print the quick-action vocabulary
 * (the same presets a human picks in the marker popover) so a review-side agent
 * can reference one by name or index via `session annotate --action`. With
 * `--session`, the vocabulary comes from that session's repo (matching what
 * `--action` will resolve); otherwise from the caller's cwd. JSON on stdout.
 */

import { loadConfig } from "@cueloop/client/config";
import { DaemonClient } from "@cueloop/daemon/client";
import { parseArgs, stringFlag } from "./args";

export async function actionsCommand(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const verb = positional[0] ?? "list";
  if (verb !== "list") {
    console.error("usage: cueloop actions list [--session <id>]");
    return 2;
  }
  const repoRoot = await repoRootForSession(stringFlag(flags, "session"));
  const actions = loadConfig({ repoRoot }).actions;
  const numbered = actions.map((action, index) => ({
    index: index + 1,
    prompt: action.prompt,
    metadata: action.metadata,
  }));
  console.log(JSON.stringify(numbered, null, 2));
  return 0;
}

/** The repo the given session lives in, or the caller's cwd when no session is named. */
async function repoRootForSession(sessionId: string | undefined): Promise<string> {
  if (sessionId === undefined) return process.cwd();
  const client = await DaemonClient.connect({ autostart: true });
  try {
    return (await client.sessionGet(sessionId)).workspace.repoRoot;
  } finally {
    client.close();
  }
}
