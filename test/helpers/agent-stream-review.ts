/** Drive a real daemon agent stream while the complete App accepts a draft. */
/* eslint-disable no-await-in-loop -- Each stream update must paint before the next input. */
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
} from "../../packages/client/src/testing/test-support";
import { NERD } from "../../packages/client/src/ui/components/primitives/icons";

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
  const originalList = client.sessionList.bind(client);
  const originalGet = client.sessionGet.bind(client);

  client.sessionList = (filter) => {
    listReads++;

    return originalList(filter);
  };
  client.sessionGet = (id) => {
    threadReads++;

    return originalGet(id);
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

      const maximumGestures = (options.paragraphs + 1) * 8;

      const gestureNumbers = Array.from({ length: maximumGestures }, (_, index) => index + 1);

      for (const gestureNumber of gestureNumbers) {
        if (setup.captureCharFrame().includes("stream-0")) break;

        await setup.mockMouse.scroll(20, 20, "down", { delayMs: 0 });

        if (gestureNumber % 16 === 0 || gestureNumber === maximumGestures) {
          await settle(setup);
        }
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
    const toggle = locateText(setup, NERD.sidebarLeftOff);

    await setup.mockMouse.click(toggle.column, toggle.row, 0, { delayMs: 0 });
    await waitForText(setup, "Other review 0");
    await control.sessionSetTitle(thread.id, "Stream renamed");
    await waitForText(setup, "Stream renamed");

    await control.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "New stream review", meta: { title: "New stream review" } },
    );
    await waitForText(setup, "New stream review");

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
