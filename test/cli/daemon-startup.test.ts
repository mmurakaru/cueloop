import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import type { Thread } from "@cueloop/schema";
import { cliJson, runCli } from "../helpers/cli";

test("CLI starts its daemon and reads a Thread from a fresh process", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-daemon-startup-"));

  try {
    const created = await runCli(home, ["session", "create", "--type", "plan"], "Review startup");

    expect(created.code).toBe(0);
    const thread = cliJson<Thread>(created);
    const loaded = await runCli(home, ["session", "get", thread.id]);

    expect(loaded.code).toBe(0);
    expect(cliJson<Thread>(loaded).artifact.content).toBe("Review startup");
  } finally {
    try {
      const client = await DaemonClient.connect({ home });

      await client.shutdown();
      client.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});
