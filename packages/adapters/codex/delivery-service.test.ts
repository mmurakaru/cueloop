import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { runHarnessBridge } from "../harness-bridge";
import { createCodexDeliveryService } from "./delivery-service";
import { createCodexSessionRegistry } from "./session-registry";

let home: string;
let server: DaemonServer;
let client: DaemonClient;
let codexBin: string;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-codex-delivery-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  client = await DaemonClient.connect({ home });
  codexBin = join(home, "codex");
  writeFileSync(
    codexBin,
    '#!/bin/sh\n[ -f fail ] && exit 1\necho sent >> invocations.txt\nprintf "%s" "$5" > messages.txt\n',
  );
  chmodSync(codexBin, 0o755);
  createCodexSessionRegistry(home).activate("codex-session-1");
});
afterEach(() => {
  client?.close();
  server?.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("createCodexDeliveryService", () => {
  test("redelivers after a failed queue and does not duplicate an acknowledged Message", async () => {
    const opened = await runHarnessBridge(
      {
        operation: "open",
        harness: "codex",
        harnessSessionId: "codex-session-1",
        cwd: home,
        workflow: "plan",
        content: "# Plan\n\nShip it.",
      },
      home,
    );

    if (opened.operation !== "open") throw new Error("expected open Thread");
    await client.sessionSendMessage(opened.threadId, "approved", "Proceed.");
    const service = createCodexDeliveryService({ home, codexBin });

    writeFileSync(join(home, "fail"), "");
    await expect(service.reconcile()).rejects.toThrow("Codex Message injection failed");
    expect(existsSync(join(home, "messages.txt"))).toBeFalse();

    unlinkSync(join(home, "fail"));
    const restarted = createCodexDeliveryService({ home, codexBin });

    await restarted.reconcile();
    await restarted.reconcile();
    expect(readFileSync(join(home, "messages.txt"), "utf8")).toContain("Proceed.");
    expect(readFileSync(join(home, "invocations.txt"), "utf8").trim().split("\n")).toHaveLength(1);
    const pending = await runHarnessBridge(
      { operation: "pending", harness: "codex", harnessSessionId: "codex-session-1" },
      home,
    );

    expect(pending.operation).toBe("pending");
    if (pending.operation !== "pending") throw new Error("expected pending response");
    expect(pending.deliveries).toEqual([]);
  });
});
