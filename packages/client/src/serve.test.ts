/**
 * SSH smoke test: serveClient on an ephemeral localhost port, a programmatic
 * ssh2 client connects with no credentials (the tunnel-of-trust model),
 * requests a PTY shell, and the first frames carry the observer TUI.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "ssh2";
import { DaemonServer } from "@cueloop/daemon";
import type { ReviewSession } from "@cueloop/schema";
import { serveClient, type ServeHandle } from "./serve";

const PLAN = "# Rollout Plan\n\nShip the store move behind a flag.\n";

let home: string;
let daemon: DaemonServer;
let session: ReviewSession;
let handle: ServeHandle;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-serve-"));
  daemon = new DaemonServer({ home, idleExitMs: 0 });
  daemon.start();
  session = daemon.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Rollout Plan", planPath: "plan.md" } },
  });
  handle = await serveClient({ port: 0, sessionId: session.id, home, banner: false });
});

afterEach(async () => {
  await handle.close();
  daemon.stop();
  rmSync(home, { recursive: true, force: true });
});

/** Connect, open a PTY shell, resolve with the bytes seen until `until` matches. */
function sshCapture(port: number, until: (frame: string) => boolean, timeoutMs = 8000): Promise<string> {
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
          stream.on("data", (chunk: Buffer) => {
            out += chunk.toString("utf8");
            if (until(out)) finish();
          });
          stream.on("close", () => finish(new Error(`stream closed early; captured:\n${out}`)));
        });
      })
      .on("error", (err) => finish(err))
      // password-less: the server runs auth "open", so `none` auth succeeds
      .connect({ host: "127.0.0.1", port, username: "observer" });
  });
}

describe("cueloop serve", () => {
  test("listens on localhost, persists a host key under CUELOOP_HOME/ssh", () => {
    // Assert
    expect(handle.host).toBe("127.0.0.1");
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.fingerprints.length).toBe(1);
    expect(handle.fingerprints[0]).toStartWith("SHA256:");
    expect(existsSync(join(home, "ssh", "host_key"))).toBe(true);
  });

  test("an anonymous ssh client gets the observer TUI for the session", async () => {
    // Act
    const bytes = await sshCapture(handle.port, (frame) => frame.includes("Rollout Plan") && frame.includes("observer"));

    // Assert
    expect(bytes).toContain("cueloop");
    expect(bytes).toContain("Rollout Plan");
    // observer chrome, not the controller's mutating hint bar
    expect(bytes).toContain("observer - read-only");
  });

  test("two observers can watch at once", async () => {
    // Act
    const [a, b] = await Promise.all([
      sshCapture(handle.port, (frame) => frame.includes("Rollout Plan")),
      sshCapture(handle.port, (frame) => frame.includes("Rollout Plan")),
    ]);

    // Assert
    expect(a).toContain("Rollout Plan");
    expect(b).toContain("Rollout Plan");
  });
});
