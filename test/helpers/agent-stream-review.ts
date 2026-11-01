/** Drive a real daemon agent stream while the complete App accepts a draft. */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createElement } from "react";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import type { AgentHarnessEvent, AgentHarnessResult } from "@cueloop/schema";
import { App } from "../../packages/client/src/app/App";
import {
  isolateUserConfig,
  renderReadyApp,
  waitForText,
  locateText,
  settle,
  waitForState,
} from "../../packages/client/src/testing/test-support";

/** A deterministic stream uses an explicit event and painted-text barrier for every character. */
export async function runTestAgentStreamReview(options: { paragraphs?: number } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cueloop-stream-review-"));
  const restore = isolateUserConfig(home, "config.toml");
  const answerPrefix = Array.from(
    { length: options.paragraphs ?? 0 },
    (_, index) =>
      `## Answer section ${index}\n\nKeep the review responsive while the agent explains a deterministic step.\n\n`,
  ).join("");

  writeFileSync(join(home, "config.toml"), "[experimental]\nthread_agent = true\n");
  let publish: ((event: AgentHarnessEvent) => void) | undefined;
  let finish: ((result: AgentHarnessResult) => void) | undefined;
  const server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: {
      enabled: true,
      adapter: {
        id: "fx",
        label: "Stream Test",
        connect(options) {
          publish = options.onEvent;

          return {
            start: async () => "stream-test",
            prompt: () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
            cancel: () => finish?.({ outcome: "cancelled" }),
            permission() {},
            close: () => {
              finish?.({ outcome: "cancelled" });
            },
          };
        },
      },
    },
  });

  server.start();
  const thread = server.core.sessionCreate({
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "Stream review", meta: { title: "Active stream" } },
  });

  for (let index = 0; index < 12; index++)
    server.core.sessionCreate({
      workspace: { repoRoot: home, branch: "main" },
      artifact: {
        type: "plan",
        content: "An unrelated review remains unchanged.\n".repeat(4000),
        meta: { title: `Other review ${index}` },
      },
    });

  const client = await DaemonClient.connect({ home });
  const control = await DaemonClient.connect({ home });
  let listReads = 0;
  let threadReads = 0;
  let observedTitle: string | undefined;
  const originalList = client.sessionList.bind(client);
  const originalGet = client.sessionGet.bind(client);

  client.sessionList = (filter) => {
    listReads++;

    return originalList(filter);
  };
  client.sessionGet = async (id) => {
    threadReads++;
    const result = await originalGet(id);

    observedTitle = result.artifact.meta.title;

    return result;
  };
  const setup = await renderReadyApp(
    createElement(App, { home, sessionId: thread.id, initialClient: client }),
    { width: 140, height: 40, kittyKeyboard: true },
  );

  try {
    await waitForText(setup, "Stream review");
    await settle(setup);
    const artifact = locateText(setup, "Stream review");

    await setup.mockMouse.click(artifact.column, artifact.row + 2, 0, { delayMs: 0 });
    await setup.mockInput.typeText("Start");
    setup.mockInput.pressKey("RETURN", { ctrl: true });
    await settle(setup);
    await control.agentGet(thread.id);

    if (!publish) throw new Error("Stream review harness did not start");

    publish({ kind: "message", id: "answer", text: answerPrefix + "stream-0", replace: true });

    if (options.paragraphs) {
      await settle(setup);

      for (let step = 0; step < 50 && !setup.captureCharFrame().includes("stream-0"); step++) {
        await setup.mockMouse.scroll(20, 20, "down", { delayMs: 0 });
        await settle(setup);
      }
    }

    await waitForText(setup, "stream-0");
    const listBefore = listReads;
    const getBefore = threadReads;
    const samples: number[] = [];
    let draft = "";

    for (let index = 1; index <= 40; index++) {
      const started = performance.now();

      publish({
        kind: "message",
        id: "answer",
        text: answerPrefix + `stream-${index}`,
        replace: true,
      });
      // The final draft stays in the same prompt while the answer changes above it.
      await setup.mockInput.typeText("x");
      draft += "x";
      await waitForText(setup, draft);
      await waitForText(setup, `stream-${index}`);
      samples.push(performance.now() - started);
    }
    await settle(setup);
    const content = setup.captureCharFrame();
    const streamReads = {
      listReads: listReads - listBefore,
      threadReads: threadReads - getBefore,
    };

    finish?.({ outcome: "completed" });
    await control.agentGet(thread.id);
    await control.sessionSetTitle(thread.id, "Renamed after streaming");
    await waitForState(
      setup,
      () => observedTitle === "Renamed after streaming",
      "Thread rename refreshes the active record",
    );
    const readsBeforeCreate = listReads;

    await control.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Created after streaming", meta: {} },
    );
    await waitForState(setup, () => listReads > readsBeforeCreate, "new Thread refreshes inbox");

    return {
      samples,
      ...streamReads,
      draftPreserved: content.includes(draft),
      streamPreserved: content.includes("stream-40"),
    };
  } finally {
    setup.renderer.destroy();
    client.close();
    control.close();
    server.stop();
    restore();
    rmSync(home, { recursive: true, force: true });
  }
}
