import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonClient } from "@cueloop/daemon/client";
import { App } from "../../packages/client/src/App";
import { runHarnessBridge } from "../../packages/adapters/harness-bridge";
import {
  dragText,
  press,
  pressKey,
  renderReadyApp,
  typeText,
  waitForText,
} from "../../packages/client/src/test-support";

const PLAN = `# Rollout Plan

## Phase 1

Ship the daemon behind a flag.

## Phase 2

Enable it for everyone immediately.
`;

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-harness-e2e-"));
});

afterAll(async () => {
  const client = await DaemonClient.connect({ home });

  await client.shutdown();
  client.close();
  rmSync(home, { recursive: true, force: true });
});

describe("Claude Thread bridge round-trip", () => {
  test("the reviewer annotates a plan and the adapter receives one durable Message", async () => {
    const opened = await runHarnessBridge(
      {
        operation: "open",
        harness: "claude-code",
        harnessSessionId: "claude-e2e",
        cwd: home,
        workflow: "plan",
        content: PLAN,
      },
      home,
    );

    expect(opened.operation).toBe("open");
    if (opened.operation !== "open") throw new Error("expected an opened Thread");
    expect(opened.approvedRetry).toBeFalse();
    const setup = await renderReadyApp(<App home={home} sessionId={opened.threadId} />, {
      width: 120,
      height: 30,
    });

    await waitForText(setup, "Rollout Plan");
    expect(setup.captureCharFrame()).toContain("Enable it for everyone immediately.");
    await dragText(setup, "Enable it", "immediately.", "immediately.".length);
    await typeText(setup, "Stage the rollout: 5% then 50% then 100%.");
    await pressKey(setup, "RETURN", { meta: true });
    await waitForText(setup, "Stage the rollout");
    await pressKey(setup, "RETURN", { meta: true });
    await waitForText(setup, "[approve]");
    await press(setup, "right");
    await waitForText(setup, "[changes]");
    await typeText(setup, "Too aggressive.");
    await pressKey(setup, "RETURN", { meta: true });

    const pending = await runHarnessBridge(
      { operation: "pending", harness: "claude-code", harnessSessionId: "claude-e2e" },
      home,
    );

    expect(pending.operation).toBe("pending");
    if (pending.operation !== "pending") throw new Error("expected pending Messages");
    expect(pending.deliveries).toHaveLength(1);
    expect(pending.deliveries[0]?.wakeText).toContain("Too aggressive.");
    expect(pending.deliveries[0]?.wakeText).toContain("Stage the rollout: 5% then 50% then 100%.");
  }, 120_000);
});
