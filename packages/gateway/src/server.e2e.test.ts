/**
 * The gateway loop end to end, over a real ssh2 client on an ephemeral port:
 * exec-upload a plan, get back the `ssh p_…` line, then shell in as that id and
 * watch the plan render. Also proves the blob sits in the store as ciphertext,
 * and that an unknown id fails with a readable message - not a hang.
 *
 * This is the black-box test for the whole gateway: server routing, the crypto,
 * the store, the blob-backed client, and the channel-to-renderer bridge.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, utils } from "ssh2";
import { SCHEMA_VERSION, type ReviewSession } from "@cueloop/schema";
import { packSessionBlob } from "@cueloop/daemon/share-blob";
import { generateMasterKey } from "./crypto";
import { startGateway, type GatewayHandle } from "./server";
import { MemoryShareStore } from "./store";

const PLAN = "# Rollout Plan\n\nShip the store move behind a flag.\n";
const SESSION: ReviewSession = {
  schemaVersion: SCHEMA_VERSION,
  id: "ses_test_1",
  workspace: { repoRoot: "/repo", branch: "main" },
  artifact: { type: "plan", content: PLAN, meta: { title: "Rollout Plan", planPath: "plan.md" } },
  revisions: [{ revision: 1, content: PLAN, submittedAt: "2026-01-01T00:00:00.000Z" }],
  annotations: [],
  verdict: null,
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const CLIENT_KEY = utils.generateKeyPairSync("ed25519").private;

let home: string;
let store: MemoryShareStore;
let handle: GatewayHandle;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-gw-"));
  store = new MemoryShareStore();
  handle = await startGateway({
    store,
    masterKey: generateMasterKey(),
    hostKeyPath: join(home, "host_key"),
    port: 0,
    host: "127.0.0.1",
    onError: () => {},
  });
});

afterEach(async () => {
  await handle.close();
  rmSync(home, { recursive: true, force: true });
});

/** Upload a blob over an exec channel; resolve with the printed ssh line. */
function shareUpload(port: number, blob: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = "";
    const timer = setTimeout(() => reject(new Error("upload timed out")), 8000);
    conn
      .on("ready", () => {
        conn.exec("cueloop-share", (err, stream) => {
          if (err) return reject(err);
          stream.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
          stream.on("close", () => {
            clearTimeout(timer);
            conn.end();
            resolve(out.trim());
          });
          stream.end(blob);
        });
      })
      .on("error", reject)
      .connect({ host: "127.0.0.1", port, username: "share", privateKey: CLIENT_KEY });
  });
}

/** Shell in as `username`; resolve with bytes seen until `until` matches. */
function shellCapture(port: number, username: string, until: (frame: string) => boolean, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = "";
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      conn.end();
      err ? reject(err) : resolve(out);
    };
    const timer = setTimeout(() => finish(new Error(`timed out; captured:\n${out}`)), timeoutMs);
    conn
      .on("ready", () => {
        conn.shell({ term: "xterm-256color", cols: 100, rows: 30 }, (err, stream) => {
          if (err) return finish(err);
          const onChunk = (chunk: Buffer) => {
            out += chunk.toString("utf8");
            if (until(out)) finish();
          };
          stream.on("data", onChunk);
          stream.stderr.on("data", onChunk);
          stream.on("close", () => finish(new Error(`stream closed early; captured:\n${out}`)));
        });
      })
      .on("error", (err) => finish(err))
      .connect({ host: "127.0.0.1", port, username, privateKey: CLIENT_KEY });
  });
}

function idFrom(sshLine: string): string {
  const match = sshLine.match(/ssh (p_[A-Za-z0-9]{8})@/);
  if (!match) throw new Error(`no share id in: ${sshLine}`);
  return match[1]!;
}

describe("share upload then view", () => {
  test("mints an ssh line, and shelling in as that id renders the plan read-only", async () => {
    // Arrange
    const line = await shareUpload(handle.port, packSessionBlob(SESSION));

    // Act
    const id = idFrom(line);
    const frames = await shellCapture(handle.port, id, (frame) => frame.includes("Rollout Plan") && frame.includes("observer"));

    // Assert
    expect(line).toMatch(/^ssh p_[A-Za-z0-9]{8}@cueloop\.dev$/);
    expect(frames).toContain("Rollout Plan");
    expect(frames).toContain("observer - read-only");
  });

  test("stores the blob as ciphertext, never the plaintext plan", async () => {
    // Arrange
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(SESSION)));

    // Act
    const stored = await store.get(id);

    // Assert
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored!).toString("utf8")).not.toContain("Rollout Plan");
  });
});

describe("viewing an unknown id", () => {
  test("fails with a readable message instead of hanging", async () => {
    // Act
    const frames = await shellCapture(handle.port, "p_zzzzzzzz", (frame) => frame.includes("not found"));

    // Assert
    expect(frames).toContain("not found or has expired");
  });
});
