import { expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DaemonClient } from "../../packages/daemon/src/client";
import { launchTuiSession } from "../helpers/pty-tui-session";
import { ptyTest } from "../helpers/pty-reviews";
import { hermeticCueloopEnvironment } from "../helpers/env";

ptyTest.skipIf(Boolean(process.env.CUELOOP_TEST_EXECUTABLE))(
  "dev:watch opens the seeded agent Thread and autostarts its configured harness",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "cueloop-dev-agent-"));
    const executable = join(
      import.meta.dirname,
      "../../packages/adapters/src/fx/testing/fake-acp.ts",
    );
    // The fixture speaks ACP directly and ignores the extra acp argument.
    const fixtureBin = join(home, "fx");
    const { writeFileSync, chmodSync } = await import("node:fs");

    writeFileSync(
      fixtureBin,
      `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${executable.replaceAll("'", "'\\''")}'\n`,
    );
    chmodSync(fixtureBin, 0o755);
    const session = launchTuiSession({
      home,
      args: [],
      sourceArgs: ["run", "dev:watch"],
      cols: 120,
      rows: 30,
      env: { CUELOOP_FX_EXECUTABLE: fixtureBin },
    });
    let client: DaemonClient | undefined;

    try {
      await session.waitForReady();
      await session.waitForText("Read the repository");
      await session.click("A seeded plan");
      await session.type("Explain retry cancellation");
      await session.press(["ctrl", "enter"]);
      await session.waitForText("The timer survives cancellation.");
      client = await DaemonClient.connect({ home });
      const thread = (await client.sessionList()).find(
        (thread) => thread.artifact.meta.title === "Read the repository",
      )!;
      const state = await client.agentGet(thread.id);

      expect(state.harness?.id).toBe("fx");
      expect(state.harness?.sessionId).toBe("fx-test-session");
    } finally {
      client?.close();
      await session.close();
      const stop = Bun.spawn(
        [
          process.execPath,
          "run",
          join(import.meta.dirname, "../../packages/cli/src/main.ts"),
          "stop",
        ],
        { env: hermeticCueloopEnvironment(home), stdout: "pipe", stderr: "pipe" },
      );

      await stop.exited;
      rmSync(home, { recursive: true, force: true });
    }
  },
);
