import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonServer } from "@cueloop/daemon";
import { App } from "./App";
import {
  isolateUserConfig,
  isolatedUserConfigPath,
  locateText,
  renderReadyApp,
  waitForState,
  waitForText,
} from "../testing/test-support";

test("New Thread opens in the launch workspace after an old temporary workspace disappears", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-new-thread-workspace-"));
  const restore = isolateUserConfig(home);
  const server = new DaemonServer({ home, idleExitMs: 0 });

  writeFileSync(isolatedUserConfigPath(home), "[experimental]\nthread_agent = true\n");
  server.start();
  const thread = server.core.sessionCreate({
    workspace: { repoRoot: join(home, "deleted-job"), branch: "detached" },
    artifact: { type: "plan", content: "# Old job", meta: { title: "Old job" } },
  });
  const setup = await renderReadyApp(<App home={home} cwd={home} sessionId={thread.id} />, {
    width: 120,
    height: 32,
  });

  try {
    await waitForText(setup, "Old job");
    await setup.mockMouse.click(4, 0);
    await waitForText(setup, "+");
    const button = locateText(setup, "+");

    await setup.mockMouse.click(button.column, button.row);
    await waitForText(setup, "New Thread");
    await waitForState(setup, () => server.core.sessionList().length === 2);
    const created = server.core.sessionList().find((entry) => entry.id !== thread.id);

    expect(created?.workspace).toEqual({ repoRoot: home, branch: "detached" });
    expect(setup.captureCharFrame()).toContain("New Thread");
    expect(server.core.sessionGet(thread.id).workspace.repoRoot).toBe(join(home, "deleted-job"));
  } finally {
    setup.renderer.destroy();
    server.stop();
    restore();
    rmSync(home, { recursive: true, force: true });
  }
});
