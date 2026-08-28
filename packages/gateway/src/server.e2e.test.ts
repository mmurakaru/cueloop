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
import { Client } from "ssh2";
import { SCHEMA_VERSION, type ReviewSession } from "@cueloop/schema";
import { packSessionBlob } from "@cueloop/daemon/share-blob";
import { generateMasterKey, openBlob } from "./crypto";
import { unpackSessionBlob } from "@cueloop/daemon/share-blob";
import { generateEd25519Key } from "./host-key";
import { startGateway, type GatewayHandle } from "./server";
import { MemoryShareStore } from "./store";

const MASTER = generateMasterKey();

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

const CLIENT_KEY = generateEd25519Key();
const OTHER_KEY = generateEd25519Key();

let home: string;
let store: MemoryShareStore;
let handle: GatewayHandle;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-gw-"));
  store = new MemoryShareStore();
  handle = await startGateway({
    store,
    masterKey: MASTER,
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

/**
 * Shell in as `username`; resolve with bytes seen until `until` matches.
 * `interact` runs once the stream opens, so a caller can drive keystrokes (e.g.
 * dismiss the first-open name prompt) before the `until` predicate is expected.
 */
function shellCapture(
  port: number,
  username: string,
  until: (frame: string) => boolean,
  timeoutMs = 20000,
  interact?: (stream: import("ssh2").ClientChannel, getFrames: () => string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = "";
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      conn.end();
      if (err) reject(err);
      else resolve(out);
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
          interact?.(stream, () => out);
        });
      })
      .on("error", (err) => finish(err))
      .connect({ host: "127.0.0.1", port, username, privateKey: CLIENT_KEY });
  });
}

/** Wait for `needle` in the frames, up to `ms`. */
async function pollFrames(getFrames: () => string, needle: string, ms = 20000): Promise<boolean> {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (getFrames().includes(needle)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }

  return false;
}

/** Open the share, skip the name prompt, quit with `q`, and resolve with every byte seen through close. */
function viewThenQuit(port: number, shareId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let frames = "";
    const timer = setTimeout(
      () => (conn.end(), reject(new Error(`quit timed out; frames:\n${frames}`))),
      35000,
    );
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const until = async (needle: string, ms = 20000) => {
      const deadline = Date.now() + ms;

      while (Date.now() < deadline) {
        if (frames.includes(needle)) return true;
        await wait(100);
      }

      return false;
    };

    conn
      .on("ready", () =>
        conn.shell({ term: "xterm-256color", cols: 100, rows: 30 }, async (err, stream) => {
          if (err) return reject(err);
          const collect = (chunk: Buffer) => (frames += chunk.toString("utf8"));

          stream.on("data", collect);
          stream.stderr.on("data", collect);
          // the channel closing on the app's graceful exit is the resolve signal
          stream.on("close", () => (clearTimeout(timer), conn.end(), resolve(frames)));
          if (!(await until("Welcome")))
            return (
              clearTimeout(timer), conn.end(), reject(new Error(`no name prompt:\n${frames}`))
            );
          await wait(300);
          stream.write("\x1b"); // skip naming
          if (!(await until("Rollout Plan")))
            return (clearTimeout(timer), conn.end(), reject(new Error(`no render:\n${frames}`)));
          await wait(400);
          stream.write("q"); // graceful quit -> restore the terminal, then close
        }),
      )
      .on("error", reject)
      .connect({ host: "127.0.0.1", port, username: shareId, privateKey: CLIENT_KEY });
  });
}

function idFrom(sshLine: string): string {
  const match = sshLine.match(/ssh (p_[A-Za-z0-9]{8})@/);

  if (!match) throw new Error(`no share id in: ${sshLine}`);

  return match[1]!;
}

describe("share upload then view", () => {
  test("mints an ssh line, and shelling in as that id renders the shared plan", async () => {
    // Arrange
    const line = await shareUpload(handle.port, packSessionBlob(SESSION));

    // Act: first open shows the name prompt over the plan; esc reveals the plan
    const id = idFrom(line);
    const frames = await shellCapture(
      handle.port,
      id,
      (frame) => frame.includes("Rollout Plan") && frame.includes("shared"),
      20000,
      async (stream, getFrames) => {
        if (await pollFrames(getFrames, "Welcome")) {
          await new Promise((r) => setTimeout(r, 300));
          stream.write("\x1b");
        }
      },
    );

    // Assert
    expect(line).toMatch(/^ssh p_[A-Za-z0-9]{8}@cueloop\.dev$/);
    expect(frames).toContain("Rollout Plan");
    // collaborator chrome (viewers annotate), not the passive observer label
    expect(frames).toContain("shared");
  });

  test("quitting restores the terminal so the client is not left spewing mouse reports", async () => {
    // Arrange
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(SESSION)));

    // Act
    const frames = await viewThenQuit(handle.port, id);

    // Assert - the disable-mouse and leave-alt-screen bytes reach the client before close
    expect(frames).toContain("\x1b[?1006l");
    expect(frames).toContain("\x1b[?1049l");
  });

  test("with metrics enabled, an upload increments the share + R2 counters at /metrics", async () => {
    // Arrange - a gateway with the loopback metrics server on
    const metricsHome = mkdtempSync(join(tmpdir(), "cueloop-gw-metrics-"));
    const metricsStore = new MemoryShareStore();
    const metricsGateway = await startGateway({
      store: metricsStore,
      masterKey: MASTER,
      hostKeyPath: join(metricsHome, "host_key"),
      port: 0,
      host: "127.0.0.1",
      metricsPort: 0,
      metricsHost: "127.0.0.1",
      onError: () => {},
    });

    try {
      // Act - one upload, then scrape /metrics
      await shareUpload(metricsGateway.port, packSessionBlob(SESSION));
      const body = await (
        await fetch(`http://127.0.0.1:${metricsGateway.metricsPort}/metrics`)
      ).text();

      // Assert - the create verb and the R2 put both counted
      expect(body).toContain('cueloop_share_ops_total{verb="create",outcome="ok"} 1');
      expect(body).toContain('cueloop_r2_ops_total{op="put",outcome="ok"} 1');
    } finally {
      await metricsGateway.close();
      rmSync(metricsHome, { recursive: true, force: true });
    }
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

/** Open the share, drive keystrokes to add one comment, then hang up. */
function annotateOverShell(port: number, shareId: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let frames = "";
    const timer = setTimeout(
      () => (conn.end(), reject(new Error(`annotate timed out; frames:\n${frames}`))),
      35000,
    );
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const until = async (needle: string, ms = 20000) => {
      const deadline = Date.now() + ms;

      while (Date.now() < deadline) {
        if (frames.includes(needle)) return true;
        await wait(100);
      }

      return false;
    };

    conn
      .on("ready", () =>
        conn.shell({ term: "xterm-256color", cols: 100, rows: 30 }, async (err, stream) => {
          if (err) return reject(err);
          const collect = (chunk: Buffer) => (frames += chunk.toString("utf8"));

          stream.on("data", collect);
          stream.stderr.on("data", collect);
          // first open opens the name prompt over the plan; esc skips it (their
          // notes read anonymous) and reveals the plan the keys below drive
          if (!(await until("Welcome")))
            return (
              clearTimeout(timer), conn.end(), reject(new Error(`no name prompt:\n${frames}`))
            );
          await wait(300);
          stream.write("\x1b");
          if (!(await until("Rollout Plan")))
            return (clearTimeout(timer), conn.end(), reject(new Error(`no render:\n${frames}`)));
          await wait(400);
          stream.write("c"); // comment on the cursor line
          await wait(700);
          stream.write(body);
          await wait(400);
          stream.write("\r"); // save -> unions into the stored blob
          await wait(1000);
          clearTimeout(timer);
          conn.end();
          resolve();
        }),
      )
      .on("error", reject)
      .connect({ host: "127.0.0.1", port, username: shareId, privateKey: CLIENT_KEY });
  });
}

/** Open the share, answer the first-open name prompt with `name`, then hang up. */
function nameSelfOverShell(port: number, shareId: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let frames = "";
    const timer = setTimeout(
      () => (conn.end(), reject(new Error(`name timed out; frames:\n${frames}`))),
      35000,
    );
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const until = async (needle: string, ms = 20000) => {
      const deadline = Date.now() + ms;

      while (Date.now() < deadline) {
        if (frames.includes(needle)) return true;
        await wait(100);
      }

      return false;
    };

    conn
      .on("ready", () =>
        conn.shell({ term: "xterm-256color", cols: 100, rows: 30 }, async (err, stream) => {
          if (err) return reject(err);
          const collect = (chunk: Buffer) => (frames += chunk.toString("utf8"));

          stream.on("data", collect);
          stream.stderr.on("data", collect);
          if (!(await until("Welcome")))
            return (
              clearTimeout(timer), conn.end(), reject(new Error(`no name prompt:\n${frames}`))
            );
          await wait(400);
          stream.write(name);
          await wait(400);
          stream.write("\r"); // save -> setSelfName unions into the stored blob
          await wait(1000);
          clearTimeout(timer);
          conn.end();
          resolve();
        }),
      )
      .on("error", reject)
      .connect({ host: "127.0.0.1", port, username: shareId, privateKey: CLIENT_KEY });
  });
}

describe("collaborator write-back", () => {
  test("a viewer annotates and the note unions into the stored blob with an author", async () => {
    // Arrange
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(SESSION)));

    // Act
    await annotateOverShell(handle.port, id, "risky move");
    const stored = unpackSessionBlob(openBlob(MASTER, id, (await store.get(id))!));

    // Assert
    const note = stored.annotations.find((annotation) => annotation.body.includes("risky move"));

    expect(note).toBeDefined();
    expect(note?.author).toMatch(/^SHA256:/);
  });

  test("a viewer names themselves and it lands in the blob's participant registry", async () => {
    // Arrange
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(SESSION)));

    // Act
    await nameSelfOverShell(handle.port, id, "Robin");
    const stored = unpackSessionBlob(openBlob(MASTER, id, (await store.get(id))!));

    // Assert
    const self = stored.participants?.find((participant) => participant.name === "Robin");

    expect(self).toBeDefined();
    expect(self?.provider).toBe("ssh");
    expect(self?.id).toMatch(/^SHA256:/);
  });
});

/** Exec `cueloop-pull` with `privateKey`, streaming the share id; capture stdout/stderr/exit. */
function sharePull(
  port: number,
  shareId: string,
  privateKey: string,
): Promise<{ out: string; err: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = "";
    let err = "";
    let code: number | null = null;
    const timer = setTimeout(() => reject(new Error("pull timed out")), 8000);

    conn
      .on("ready", () => {
        conn.exec("cueloop-pull", (error, stream) => {
          if (error) return reject(error);
          stream.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
          stream.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
          stream.on("exit", (exitCode: number) => (code = exitCode));
          stream.on("close", () => {
            clearTimeout(timer);
            conn.end();
            resolve({ out, err, code });
          });
          stream.end(shareId);
        });
      })
      .on("error", reject)
      .connect({ host: "127.0.0.1", port, username: "share", privateKey });
  });
}

describe("planner pull", () => {
  test("the fingerprint that shared it pulls the session back with collaborator notes", async () => {
    // Arrange
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(SESSION)));

    await annotateOverShell(handle.port, id, "pull me back");

    // Act
    const result = await sharePull(handle.port, id, CLIENT_KEY);
    const pulled = JSON.parse(result.out) as ReviewSession;

    // Assert
    expect(result.code).toBe(0);
    expect(pulled.annotations.some((annotation) => annotation.body.includes("pull me back"))).toBe(
      true,
    );
  });

  test("a fingerprint that did not share it is refused", async () => {
    // Arrange
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(SESSION)));

    // Act
    const result = await sharePull(handle.port, id, OTHER_KEY);

    // Assert
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("only the planner who shared this can pull it");
  });
});

/** Exec `cueloop-push` with `privateKey`, streaming {shareId, annotations}; capture stderr/exit. */
function sharePush(
  port: number,
  shareId: string,
  annotations: object[],
  privateKey: string,
): Promise<{ err: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let err = "";
    let code: number | null = null;
    const timer = setTimeout(() => reject(new Error("push timed out")), 8000);

    conn
      .on("ready", () => {
        conn.exec("cueloop-push", (error, stream) => {
          if (error) return reject(error);
          stream.on("data", () => {});
          stream.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
          stream.on("exit", (exitCode: number) => (code = exitCode));
          stream.on("close", () => {
            clearTimeout(timer);
            conn.end();
            resolve({ err, code });
          });
          stream.end(JSON.stringify({ shareId, annotations }));
        });
      })
      .on("error", reject)
      .connect({ host: "127.0.0.1", port, username: "share", privateKey });
  });
}

describe("planner push", () => {
  test("the owner mirrors a note up and it lands in the blob, unauthored and stamped", async () => {
    // Arrange
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(SESSION)));
    const note = {
      id: "planner-1",
      kind: "comment",
      anchor: { quote: "Rollout", prefix: "", suffix: "" },
      body: "from the planner",
    };

    // Act
    const result = await sharePush(handle.port, id, [note], CLIENT_KEY);
    const stored = unpackSessionBlob(openBlob(MASTER, id, (await store.get(id))!));

    // Assert
    expect(result.code).toBe(0);
    const landed = stored.annotations.find((annotation) => annotation.id === "planner-1");

    expect(landed?.body).toBe("from the planner");
    expect(landed?.author).toBeUndefined();
    expect(landed?.createdAt).toBeTruthy();
  });

  test("a fingerprint that did not share it is refused", async () => {
    // Arrange
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(SESSION)));
    const note = {
      id: "x",
      kind: "comment",
      anchor: { quote: "Rollout", prefix: "", suffix: "" },
      body: "nope",
    };

    // Act
    const result = await sharePush(handle.port, id, [note], OTHER_KEY);

    // Assert
    expect(result.code).not.toBe(0);
    expect(result.err).toContain("only the planner who shared this can push to it");
  });

  test("strips a spoofed author off a pushed note", async () => {
    // Arrange
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(SESSION)));
    const note = {
      id: "spoof-1",
      kind: "comment",
      anchor: { quote: "Rollout", prefix: "", suffix: "" },
      body: "not really theirs",
      author: "SHA256:someone-else",
    };

    // Act
    await sharePush(handle.port, id, [note], CLIENT_KEY);
    const stored = unpackSessionBlob(openBlob(MASTER, id, (await store.get(id))!));

    // Assert
    expect(
      stored.annotations.find((annotation) => annotation.id === "spoof-1")?.author,
    ).toBeUndefined();
  });
});

describe("upload hygiene", () => {
  test("strips the planner's local shareId from the stored blob", async () => {
    // Arrange - a re-shared session carries an old shareId; it must not reach the blob
    const carried = { ...SESSION, shareId: "p_oldshare" };

    // Act
    const id = idFrom(await shareUpload(handle.port, packSessionBlob(carried)));
    const stored = unpackSessionBlob(openBlob(MASTER, id, (await store.get(id))!));

    // Assert
    expect(stored.shareId).toBeUndefined();
    expect(stored.owner).toBeTruthy();
  });
});

describe("viewing an unknown id", () => {
  test("fails with a readable message instead of hanging", async () => {
    // Act
    const frames = await shellCapture(handle.port, "p_zzzzzzzz", (frame) =>
      frame.includes("not found"),
    );

    // Assert
    expect(frames).toContain("not found or has expired");
  });
});
