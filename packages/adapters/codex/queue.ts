/**
 * Codex live-injection: queue a follow-up turn into a running Codex thread with
 * the shipped `codex queue` CLI, which calls the app-server thread/queue/add
 * method. The queued message auto-submits when the thread next goes idle - the
 * non-blocking "verdict continues the driving agent" shape, with no hand-rolled
 * JSON-RPC.
 *
 * Requires the driving Codex to run under the shared app-server daemon: a
 * private embedded app-server holds a single-writer lock and the queue add
 * fails. This is the weakest of the three native wake paths (ADR 0008) - it is
 * shipped last, kept to this thin CLI shell-out, and its flags are pinned to the
 * `codex queue --thread <id> --message <text>` contract from the Codex source
 * (cli/src/queue_cmd.rs). Needs live-codex QA before it is trusted.
 */

/** One queued follow-up for a running Codex thread. */
export interface CodexQueueOptions {
  /** The Codex thread/session id to queue into. */
  threadId: string;
  message: string;
  /** Codex binary; defaults to "codex" on PATH. */
  codexBin?: string;
  cwd?: string;
}

export interface CodexQueueResult {
  ok: boolean;
  /** Stderr tail when the queue add failed (e.g. the daemon lacks thread/queue/add). */
  error?: string;
}

/** Shell out to `codex queue`; resolves ok=false with the stderr tail on any non-zero exit. */
export async function queueCodexMessage(options: CodexQueueOptions): Promise<CodexQueueResult> {
  const codexBinary = options.codexBin ?? "codex";

  try {
    const proc = Bun.spawn(
      [codexBinary, "queue", "--thread", options.threadId, "--message", options.message],
      { cwd: options.cwd, stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

    if (exitCode === 0) return { ok: true };

    return { ok: false, error: stderr.trim() || `codex queue exited ${exitCode}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
