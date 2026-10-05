import { createFxHarness } from "@cueloop/adapters/fx/harness";
import { expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "../../packages/daemon/src/server";
import { DaemonClient } from "../../packages/daemon/src/client";
import { launchTuiSession } from "../helpers/pty-tui-session";
import { createTestGitRepo } from "../helpers/git-repo";
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
      await session.press("down");
      await session.press("down");
      expect(session.cursor().visible).toBe(false);
      await session.type("Cursor check");
      expect(session.cursor().visible).toBe(true);
      await session.press("escape");
      const selection = session.locate("Keep the retry bounded.");

      await session.dragAt(selection.column, selection.row, selection.column + 9, selection.row);
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
      await session.press("escape");
      const timer = session.locate("The timer survives cancellation.");

      await session.clickAt(timer.column + 5, timer.row + 1);
      await session.waitForScreen(() => session.cursor().visible);
      expect(session.cursor().visible).toBe(true);
      await session.press("escape");
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

ptyTest(
  "Changes saves inline with Option Enter and mirrors only after Control Enter",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "cueloop-agent-diff-"));
    const repo = createTestGitRepo([
      { path: "example.ts", before: "const count = 1;\n", after: "const count = 2;\n" },
    ]);
    const diff = await repo.diff();
    const server = new DaemonServer({
      home,
      idleExitMs: 0,
      threadAgent: {
        enabled: true,
        adapter: createFxHarness({
          command: [
            process.execPath,
            join(import.meta.dirname, "../../packages/adapters/src/fx/testing/fake-acp.ts"),
          ],
        }),
      },
    });

    server.start();
    const client = await DaemonClient.connect({ home });
    const thread = server.core.sessionCreate({
      workspace: { repoRoot: repo.dir, branch: "main" },
      artifact: {
        type: "diff",
        content: diff.patch,
        files: diff.files,
        meta: { title: "Count review" },
      },
    });

    writeFileSync(
      join(home, "no-config.toml"),
      '[experimental]\nthread_agent = true\n[ui]\nlayout = { threads = true, right_sidebar = "off", zoom_changes = false }\n',
    );
    let session = launchTuiSession({ home, args: [thread.id], cols: 160, rows: 40 });

    try {
      await session.waitForReady();
      await session.waitForText("const count = 2;");
      const selection = session.locate("const count = 2;");

      await session.dragAt(selection.column, selection.row, selection.column + 9, selection.row);
      await session.type("Explain this change");
      await session.press(["alt", "enter"]);
      await session.waitForText("Send message (1)");
      expect((session.text().match(/Explain this change/g) ?? []).length).toBe(1);
      expect((await client.agentGet(thread.id)).submissions ?? []).toHaveLength(0);
      await session.click("Explain this change");
      await session.type(" please");
      await session.press(["alt", "enter"]);
      await session.waitForText("Explain this change please");
      expect((await client.sessionGet(thread.id)).annotations[0]?.body).toBe(
        "Explain this change please",
      );
      await session.press(["ctrl", "enter"]);
      await session.waitForText("The timer survives cancellation.");
      expect(session.text()).not.toContain("skill catalog shortened");
      expect(session.text()).not.toContain("skill discovery warning");
      const state = await client.agentGet(thread.id);

      expect(
        state.messages.some((message) => message.text.includes("skill catalog shortened")),
      ).toBe(false);

      expect(state.submissions).toHaveLength(1);
      expect(state.submissions?.[0]?.commentId).toBe(
        (await client.sessionGet(thread.id)).annotations[0]?.id,
      );
      expect((session.text().match(/Explain this change please/g) ?? []).length).toBe(2);
      await session.close();
      session = launchTuiSession({ home, args: [], cols: 160, rows: 40 });
      await session.waitForReady();
      await session.waitForScreen(
        (screen) =>
          screen.split("\n").some((line) => line.includes("Threads") && line.includes("+")),
        { what: "Threads section with its New Thread button" },
      );
      const lines = session.text().split("\n");
      const row = lines.findIndex((line) => line.includes("Threads") && line.includes("+"));
      const column = lines[row]!.indexOf("+");

      expect(column).toBeGreaterThan(lines[row]!.indexOf("Threads"));
      session.writeRaw(`\x1b[<35;${column + 1};${row + 1}M`);
      await session.waitForText("New Thread");
      await session.clickAt(column, row);
      await session.waitForText("Send message (0)");
      await session.clickAt(60, 8);
      expect(session.cursor().visible).toBe(true);
      await session.type("Hello from an empty Thread");
      expect(session.cursor().visible).toBe(true);
      expect(session.text()).not.toContain("● Hello from an empty Thread");
      await session.press(["alt", "enter"]);
      await session.type(" again");
      await session.press(["ctrl", "enter"]);
      await session.waitForText("The timer survives cancellation.");
      expect(session.text()).not.toContain("● Hello from an empty Thread");
      expect(session.text()).not.toContain("✓✓");
      const created = (await client.sessionList()).find(
        (entry) => entry.artifact.meta.title === "New Thread",
      );

      expect(created?.artifact.content).toBe("");
      expect((await client.agentGet(created!.id)).submissions?.[0]?.prompt).toBe(
        "Hello from an empty Thread again",
      );
      await session.waitForScreen(
        (screen) => {
          const replyRow = screen
            .split("\n")
            .findIndex((line) => line.includes("The timer survives cancellation."));

          return session.cursor().visible && session.cursor().y > replyRow;
        },
        { what: "continuation cursor below the completed reply" },
      );
      await session.type("Continue without another click");
      await session.press(["ctrl", "enter"]);
      await session.waitForScreen(
        (screen) => (screen.match(/The timer survives cancellation\./g) ?? []).length === 2,
        { what: "second reply after typing directly into the continuation prompt" },
      );
      expect((await client.agentGet(created!.id)).submissions?.[1]?.prompt).toBe(
        "Continue without another click",
      );
    } finally {
      await session.close();
      client.close();
      server.stop();
      repo.cleanup();
      rmSync(home, { recursive: true, force: true });
    }
  },
  30_000,
);
