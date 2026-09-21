import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";

test("the two-terminal example receives and acknowledges a Message", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-example-roundtrip-"));
  const server = new DaemonServer({ home, idleExitMs: 0 });

  server.start();
  const client = await DaemonClient.connect({ home });
  const child = Bun.spawn(
    [process.execPath, "run", join(import.meta.dir, "../../examples/2-agent-roundtrip/run.ts")],
    {
      env: {
        ...process.env,
        CUELOOP_HOME: home,
        CUELOOP_EXAMPLE_SESSION_ID: "example-test",
        HERDR_ENV: "",
        GHOSTTY_RESOURCES_DIR: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  try {
    let threadId: string | undefined;

    for (let attempt = 0; attempt < 100; attempt++) {
      threadId = (await client.sessionList({ status: "pending" }))[0]?.id;

      if (threadId) break;
      await Bun.sleep(10);
    }
    if (!threadId) throw new Error("example did not open a Thread");
    await client.sessionSendMessage(threadId, "approved", "Example approved.");
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(5_000).then(() => {
        throw new Error("example did not receive its Message");
      }),
    ]);
    const output = await new Response(child.stdout).text();

    expect(exitCode).toBe(0);
    expect(output).toContain("Example approved.");
    const [binding] = await client.harnessBindingsForSession("claude-code", "example-test");

    expect(binding).toBeDefined();
    expect(await client.deliveryPending(binding!.id)).toEqual([]);
  } finally {
    child.kill();
    client.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
