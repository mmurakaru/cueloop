import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient, DaemonClientError } from "@cueloop/daemon/client";

const CLI_ENTRY = join(import.meta.dir, "../../packages/cli/src/main.ts");
let home: string;
let server: DaemonServer;
let client: DaemonClient;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-session-delete-cli-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  client = await DaemonClient.connect({ home });
});

afterEach(() => {
  client.close();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("cueloop session delete", () => {
  test("deletes the selected Thread", async () => {
    const thread = await client.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "# Plan", meta: {} },
    );
    const processHandle = Bun.spawn(
      [process.execPath, "run", CLI_ENTRY, "session", "delete", thread.id],
      {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, CUELOOP_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(await processHandle.exited).toBe(0);
    expect(await new Response(processHandle.stdout).text()).toBe("{}\n");
    await expect(client.sessionGet(thread.id)).rejects.toBeInstanceOf(DaemonClientError);
  });
});
