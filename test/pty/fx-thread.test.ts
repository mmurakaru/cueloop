import { createFxHarness } from "@cueloop/adapters/fx/harness";
import { expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "../../packages/daemon/src/server";
import { DaemonClient } from "../../packages/daemon/src/client";
import { launchTuiSession } from "../helpers/pty-tui-session";
import { ptyTest } from "../helpers/pty-reviews";
import { createTestFxProvider } from "../helpers/fx-provider";

ptyTest(
  "agent Thread supports asking, annotating an answer, resizing, and reopening without duplicate history",
  async () => {
    const provider = process.env.CUELOOP_TEST_FX
      ? createTestFxProvider({ readFile: true })
      : undefined;
    const home = mkdtempSync(join(tmpdir(), "cueloop-fx-pty-"));
    const server = new DaemonServer({
      home,
      idleExitMs: 0,
      threadAgent: {
        enabled: true,
        adapter: createFxHarness({
          command: provider
            ? [process.env.CUELOOP_TEST_FX!, "acp"]
            : [
                process.execPath,
                join(import.meta.dirname, "../../packages/adapters/src/fx/testing/fake-acp.ts"),
              ],
          env: provider?.env,
        }),
      },
    });
    server.start();
    const client = await DaemonClient.connect({ home });
    const thread = server.core.sessionCreate({
      workspace: { repoRoot: provider?.workspace ?? home, branch: "main" },
      artifact: {
        type: "plan",
        content: "# Retry review\n\nKeep the retry bounded.",
        meta: { title: "Retry review" },
      },
    });
    writeFileSync(join(home, "no-config.toml"), "[experimental]\nthread_agent = true\n");
    let session = launchTuiSession({
      home,
      args: [thread.id],
      cols: 120,
      rows: 30,
    });

    try {
      await session.waitForReady();
      await session.waitForText("Keep the retry bounded.");
      await session.click("Keep the retry bounded.");
      await session.type("Explain retries");
      await session.press(["alt", "enter"]);
      await session.waitForText("Send message (1)");
      expect((await client.agentGet(thread.id)).messages).toHaveLength(0);
      expect((await client.sessionGet(thread.id)).annotations[0]?.body).toBe("Explain retries");
      await session.click("Explain retries");
      await session.type(" please");
      await session.press(["alt", "enter"]);
      expect((await client.sessionGet(thread.id)).annotations[0]?.body).toBe(
        "Explain retries please",
      );
      expect((await client.agentGet(thread.id)).messages).toHaveLength(0);
      await session.press(["ctrl", "enter"]);
      await session.waitForText("The timer survives cancellation.");
      const timer = session.locate("The timer survives cancellation.");

      await session.dragAt(timer.column, timer.row, timer.column + 9, timer.row);
      await session.type("Explain the cleanup");
      await session.press(["ctrl", "enter"]);
      await session.waitForText("Explain the cleanup");
      const state = await client.agentGet(thread.id);

      expect(state.comments[0]?.anchor.quote).toBe("The timer");
      expect(state.comments[0]?.messageId).toBe(
        state.messages.find((message) => message.role === "agent")?.id,
      );
      session.resize(90, 24);
      await session.waitForScreen(
        (screen) => screen.includes("Retry review") && screen.includes("Send message (1)"),
        { what: "resized Thread header and composer" },
      );
      if (process.env.CUELOOP_FX_CAPTURE)
        writeFileSync(process.env.CUELOOP_FX_CAPTURE, session.text());
      await session.close();
      session = launchTuiSession({
        home,
        args: [thread.id],
        cols: 120,
        rows: 30,
      });
      await session.waitForReady();
      await session.waitForText("Send message (1)");
      await session.click("Send message (1)");
      await session.waitForText("[approve]");
      await session.press("escape");
      const restored = await client.agentGet(thread.id);

      expect(restored.harness?.sessionId).toBe(state.harness?.sessionId);
      expect(
        restored.messages.filter((message) => message.id === state.messages[1]?.id),
      ).toHaveLength(1);
      expect(restored.comments[0]?.sent).toBe(true);
      await session.waitForText("Keep the retry bounded.");
      expect((await client.sessionGet(thread.id)).artifact.content).toBe(thread.artifact.content);
    } finally {
      await session.close();
      client.close();
      server.stop();
      provider?.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
  30_000,
);
