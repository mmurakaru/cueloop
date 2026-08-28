/**
 * Claude Code's per-session inbox socket: how an own-child process posts a
 * message into a live session, which Claude reads between tool calls (or as a
 * fresh turn when idle). This is the wake transport for the non-blocking review
 * flow - a detached waiter posts the verdict here so the driving agent resumes
 * without a pinned, blocking tool call.
 *
 * Wire format taken verbatim from Claude Code's own embedded example (v2.1.238,
 * `claude --help` messaging section): two newline-delimited JSON frames, the
 * documented auth line first, then the user message:
 *   {"type":"auth","token":"<CLAUDE_CODE_MESSAGING_TOKEN>"}
 *   {"type":"user","message":{"role":"user","content":"<text>"}}
 * Fire-and-forget: the sender writes both lines and closes; there is no ack to
 * read. Posting to the session's OWN socket needs no recipient routing.
 */

import { connect } from "bun";

/** The inbox coordinates a child process inherits from its Claude Code session. */
export interface ClaudeInbox {
  socketPath: string;
  /** Absent when the session exported no token; own-child auth then relies on process evidence. */
  token?: string;
}

/**
 * Read the inbox coordinates a Claude Code session exports to its children.
 * Null when this process is not a child of a messaging-enabled session. The
 * socket path env var is the bare filesystem path; the `uds:` prefix only ever
 * appears in `/status`, but strip it defensively in case a caller passes that.
 */
export function claudeInboxFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): ClaudeInbox | null {
  const rawSocketPath = environment.CLAUDE_CODE_MESSAGING_SOCKET;

  if (!rawSocketPath) return null;
  const socketPath = rawSocketPath.startsWith("uds:")
    ? rawSocketPath.slice("uds:".length)
    : rawSocketPath;

  return { socketPath, token: environment.CLAUDE_CODE_MESSAGING_TOKEN };
}

/** The two newline-delimited frames a post sends, in order. */
export function inboxFrames(content: string, token?: string): string {
  const authLine = token === undefined ? "" : JSON.stringify({ type: "auth", token }) + "\n";
  const messageLine = JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";

  return authLine + messageLine;
}

/**
 * Post one message into the session that owns `inbox`. Resolves once both frames
 * are flushed and the socket is closed; rejects only if the connection itself
 * fails (a dead socket means the session is gone).
 */
export async function postToInbox(inbox: ClaudeInbox, content: string): Promise<void> {
  const payload = inboxFrames(content, inbox.token);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    connect({
      unix: inbox.socketPath,
      socket: {
        open: (socket) => {
          socket.write(payload);
          socket.flush();
          socket.end();
        },
        data: () => {
          // The inbox never replies; a no-op keeps Bun's socket handler valid.
        },
        close: () => {
          if (settled) return;
          settled = true;
          resolve();
        },
        error: (_socket, error) => {
          if (settled) return;
          settled = true;
          reject(error);
        },
      },
    }).catch((error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}
