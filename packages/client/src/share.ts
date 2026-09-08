/**
 * Publish a review session as a share: pack it, stream it to the gateway's
 * `share` user over SSH, and copy the returned `ssh p_…@host` line to the
 * clipboard. The planner holds no key, so all this side does is upload; the
 * gateway seals and stores. Used by both `cueloop share` and the in-TUI
 * Share button, so the two share exactly the same path.
 */

import {
  DEFAULT_SHARE_HOST,
  DEFAULT_SHARE_PORT,
  SHARE_UPLOAD_USER,
  packSessionBlob,
} from "@cueloop/daemon/share-blob";
import {
  removalEntries,
  viewFollowing,
  type Annotation,
  type ReviewSession,
} from "@cueloop/schema";
import { SessionRecordSchema } from "@cueloop/daemon/validate";
import type { SharedMerge } from "@cueloop/daemon/client";
import * as v from "valibot";
import { copyToClipboard } from "./clipboard";

export interface ShareTarget {
  host?: string;
  port?: number;
}

export interface ShareResult {
  /** The one line to paste: `ssh p_xxxxxxxx@host`. */
  line: string;
  /** Whether the line made it onto the system clipboard. */
  copied: boolean;
}

/** The `p_…` share id inside a `ssh p_…@host` line, or undefined. */
export function shareIdFromLine(line: string): string | undefined {
  return line.match(/^ssh (\S+)@/)?.[1];
}

/** Upload the session to the gateway and copy the resulting ssh line. */
export async function publishShare(
  session: ReviewSession,
  target: ShareTarget = {},
): Promise<ShareResult> {
  const { stdout, stderr, code } = await runShareSsh(
    "cueloop-share",
    // the share follows one branch: collaborators see its path wherever the owner stands
    packSessionBlob(viewFollowing(session)),
    target,
  );

  if (code !== 0)
    throw new Error(`gateway upload failed: ${stderr.trim() || `ssh exited ${code}`}`);
  const line = stdout.trim();

  if (!line.startsWith("ssh ")) throw new Error(`unexpected gateway reply: ${line || "(empty)"}`);
  const copied = await copyToClipboard(line);

  return { line, copied };
}

/**
 * Pull a share's current session back from the gateway. The gateway lets only
 * the fingerprint that uploaded it through, so collaborator notes reach the
 * planner without exposing the master key.
 */
export async function pullShare(shareId: string, target: ShareTarget = {}): Promise<ReviewSession> {
  const { stdout, stderr, code } = await runShareSsh("cueloop-pull", Buffer.from(shareId), target);

  if (code !== 0) throw new Error(`gateway pull failed: ${stderr.trim() || `ssh exited ${code}`}`);

  return v.parse(SessionRecordSchema, JSON.parse(stdout));
}

/** A share's collaborator notes: the ones a viewer authored (author stamped). */
export function collaboratorAnnotations(session: ReviewSession): Annotation[] {
  return session.annotations.filter((annotation) => annotation.author);
}

/**
 * What a pulled share hands the local merge: collaborators' notes, the
 * participant registry, and the removals the share recorded, by entry id.
 */
export function mergeFromShare(remote: ReviewSession): SharedMerge {
  const merge: SharedMerge = { annotations: collaboratorAnnotations(remote) };

  if (remote.participants) merge.participants = remote.participants;
  if (remote.history) {
    merge.removals = removalEntries(remote.history).map((entry) => ({
      id: entry.id,
      annotationId: entry.annotationId,
      createdAt: entry.createdAt,
    }));
  }

  return merge;
}

/**
 * Mirror the planner's own annotations up into the share, so collaborators see
 * them on their next refresh. Owner-gated at the gateway; the notes stay
 * unauthored (the planner's), unioned by id.
 */
export async function pushShare(
  shareId: string,
  annotations: Array<Omit<Annotation, "createdAt">>,
  target: ShareTarget = {},
): Promise<void> {
  const { stderr, code } = await runShareSsh(
    "cueloop-push",
    Buffer.from(JSON.stringify({ shareId, annotations })),
    target,
  );

  if (code !== 0) throw new Error(`gateway push failed: ${stderr.trim() || `ssh exited ${code}`}`);
}

export interface ShareWatchHandlers {
  /** The whole session record, each time the share changes. */
  onSession: (session: ReviewSession) => void;
  /** The stream ended, for any reason; the caller decides whether to reconnect. */
  onClose: (reason: string) => void;
}

const WatchFrameSchema = v.variant("type", [
  v.object({ type: v.literal("ready") }),
  v.object({ type: v.literal("ping") }),
  v.object({ type: v.literal("session"), session: SessionRecordSchema }),
]);

/**
 * Follow a share live: one long-lived `cueloop-watch` ssh stream that carries
 * a JSON line per change. Owner-gated at the gateway. Returns a stop handle.
 */
export function watchShare(
  shareId: string,
  handlers: ShareWatchHandlers,
  target: ShareTarget = {},
): () => void {
  const proc = Bun.spawn(shareSshCommand("cueloop-watch", target), {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(shareId);
  proc.stdin.end();
  void readLines(proc.stdout, (line) => {
    const frame = v.safeParse(WatchFrameSchema, JSON.parse(line));

    if (frame.success && frame.output.type === "session") handlers.onSession(frame.output.session);
  }).catch(() => {});
  void Promise.all([proc.exited, new Response(proc.stderr).text()]).then(([code, stderr]) =>
    handlers.onClose(stderr.trim() || `ssh exited ${code}`),
  );

  return () => proc.kill();
}

/** Feed each complete line of a byte stream to `onLine`; a torn line is dropped. */
async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let pending = "";

  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");

    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        onLine(line);
      } catch {
        // one bad line never ends the stream
      }
    }
  }
}

function shareSshCommand(command: string, target: ShareTarget): string[] {
  const host = target.host ?? DEFAULT_SHARE_HOST;
  const port = target.port ?? DEFAULT_SHARE_PORT;

  return [
    "ssh",
    "-p",
    String(port),
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${SHARE_UPLOAD_USER}@${host}`,
    command,
  ];
}

/** Run one `share@host:port` ssh command with `stdin`; hand back its streams and exit code. */
async function runShareSsh(
  command: string,
  stdin: Buffer,
  target: ShareTarget,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(shareSshCommand(command, target), {
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, code };
}
