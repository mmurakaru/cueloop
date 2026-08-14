/**
 * `cueloop share [session-id]` - hand a plan to a teammate as one SSH line.
 * The planner holds no encryption key (only the gateway does), so all this
 * side does is serialise the session and stream it to the gateway's `share`
 * user over SSH; the gateway seals it, stores it, and answers the ssh line,
 * which we copy to the clipboard (falling back to printing it, e.g. over SSH).
 *
 * The transport and clipboard are injected so the orchestration is testable
 * without a live gateway or a real system clipboard.
 */

import { DaemonClient, type SessionClient } from "@cueloop/daemon/client";
import { SHARE_UPLOAD_USER, packSessionBlob } from "@cueloop/daemon/share-blob";
import type { ReviewSession } from "@cueloop/schema";
import { copyToClipboard } from "./clipboard";

const DEFAULT_HOST = "cueloop.dev";
const DEFAULT_PORT = 22;

export interface ShareParams {
  sessionId?: string;
  host?: string;
  port?: number;
  home?: string;
}

export interface ShareIo {
  /** Stream the blob to `share@host:port`; resolve with the gateway's ssh line. */
  upload(blob: Buffer, host: string, port: number): Promise<string>;
  copy(text: string): Promise<boolean>;
  out(message: string): void;
}

const defaultIo: ShareIo = {
  upload: uploadOverSsh,
  copy: copyToClipboard,
  out: (message) => console.log(message),
};

/** Connect to the local daemon, then share the chosen session. */
export async function shareCommand(params: ShareParams, io: ShareIo = defaultIo): Promise<number> {
  const client = await DaemonClient.connect({ home: params.home, autostart: true });
  try {
    return await shareSession(client, params, io);
  } finally {
    client.close();
  }
}

/** The orchestration, over any SessionClient - the seam the tests drive. */
export async function shareSession(client: SessionClient, params: ShareParams, io: ShareIo): Promise<number> {
  const session = await pickSession(client, params.sessionId);
  if (!session) {
    io.out("no plan to share - open a review first");
    return 1;
  }
  const line = await io.upload(packSessionBlob(session), params.host ?? DEFAULT_HOST, params.port ?? DEFAULT_PORT);
  const copied = await io.copy(line);
  io.out(copied ? `share link copied - ${line}` : line);
  return 0;
}

/** The named session, or the most recent one when no id is given. */
async function pickSession(client: SessionClient, sessionId?: string): Promise<ReviewSession | null> {
  if (sessionId) return client.sessionGet(sessionId);
  const sessions = await client.sessionList();
  return sessions.at(-1) ?? null;
}

/** Stream the blob to the gateway over the system `ssh` client. */
async function uploadOverSsh(blob: Buffer, host: string, port: number): Promise<string> {
  const proc = Bun.spawn(
    ["ssh", "-p", String(port), "-o", "StrictHostKeyChecking=accept-new", `${SHARE_UPLOAD_USER}@${host}`, "cueloop-share"],
    { stdin: blob, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gateway upload failed: ${stderr.trim() || `ssh exited ${code}`}`);
  const line = stdout.trim();
  if (!line.startsWith("ssh ")) throw new Error(`unexpected gateway reply: ${line || "(empty)"}`);
  return line;
}
