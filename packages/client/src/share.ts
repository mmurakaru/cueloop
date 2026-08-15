/**
 * Publish a review session as a share: pack it, stream it to the gateway's
 * `share` user over SSH, and copy the returned `ssh p_…@host` line to the
 * clipboard. The planner holds no key, so all this side does is upload; the
 * gateway seals and stores. Used by both `cueloop share` and the in-TUI
 * Share button, so the two share exactly the same path.
 */

import { DEFAULT_SHARE_HOST, DEFAULT_SHARE_PORT, SHARE_UPLOAD_USER, packSessionBlob } from "@cueloop/daemon/share-blob";
import type { ReviewSession } from "@cueloop/schema";
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
export async function publishShare(session: ReviewSession, target: ShareTarget = {}): Promise<ShareResult> {
  const line = await uploadOverSsh(packSessionBlob(session), target.host ?? DEFAULT_SHARE_HOST, target.port ?? DEFAULT_SHARE_PORT);
  const copied = await copyToClipboard(line);
  return { line, copied };
}

/**
 * Pull a share's current session back from the gateway. Only the fingerprint
 * that uploaded it is let through, so collaborator notes flow to the planner
 * without exposing the master key. Returns the decrypted session.
 */
export async function pullShare(shareId: string, target: ShareTarget = {}): Promise<ReviewSession> {
  const json = await pullOverSsh(shareId, target.host ?? DEFAULT_SHARE_HOST, target.port ?? DEFAULT_SHARE_PORT);
  return JSON.parse(json) as ReviewSession;
}

/** Stream the blob to `share@host:port` over the system `ssh` client. */
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

/** Send the share id to `share@host:port` and read back the session JSON. */
async function pullOverSsh(shareId: string, host: string, port: number): Promise<string> {
  const proc = Bun.spawn(
    ["ssh", "-p", String(port), "-o", "StrictHostKeyChecking=accept-new", `${SHARE_UPLOAD_USER}@${host}`, "cueloop-pull"],
    { stdin: Buffer.from(shareId), stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gateway pull failed: ${stderr.trim() || `ssh exited ${code}`}`);
  return stdout;
}
