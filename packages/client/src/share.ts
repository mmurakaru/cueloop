/**
 * Publish a review session as a share: pack it, stream it to the gateway's
 * `share` user over SSH, and copy the returned `ssh p_…@host` line to the
 * clipboard. The planner holds no key, so all this side does is upload; the
 * gateway seals and stores. Used by both `cueloop share` and the in-TUI
 * Share button, so the two share exactly the same path.
 */

import { SHARE_UPLOAD_USER, packSessionBlob } from "@cueloop/daemon/share-blob";
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

const DEFAULT_HOST = "cueloop.dev";
const DEFAULT_PORT = 22;

/** Upload the session to the gateway and copy the resulting ssh line. */
export async function publishShare(session: ReviewSession, target: ShareTarget = {}): Promise<ShareResult> {
  const line = await uploadOverSsh(packSessionBlob(session), target.host ?? DEFAULT_HOST, target.port ?? DEFAULT_PORT);
  const copied = await copyToClipboard(line);
  return { line, copied };
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
