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
