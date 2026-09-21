import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@cueloop/schema";
import { DeliveredMessageStore } from "./delivered-message-store";

const home = mkdtempSync(join(tmpdir(), "cueloop-delivered-messages-"));
const path = join(home, "ids.json");
const message: Message = {
  id: "msg_1",
  outcome: "approved",
  summary: "Ready.",
  body: "# Review: approved",
  sentAt: "2026-09-21T00:00:00.000Z",
};

afterEach(() => {
  rmSync(path, { force: true });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("DeliveredMessageStore", () => {
  test("deduplicates a successful injection after adapter reload", async () => {
    const injected: Message[] = [];
    const first = new DeliveredMessageStore(path);

    await first.sendOnce(message, (payload) => {
      injected.push(payload);
    });
    await new DeliveredMessageStore(path).sendOnce(message, (payload) => {
      injected.push(payload);
    });

    expect(injected).toEqual([message]);
  });

  test("does not record a failed native injection", async () => {
    const first = new DeliveredMessageStore(path);

    await expect(
      first.sendOnce(message, () => {
        throw new Error("native send failed");
      }),
    ).rejects.toThrow("native send failed");

    const injected: Message[] = [];

    await new DeliveredMessageStore(path).sendOnce(message, (payload) => {
      injected.push(payload);
    });

    expect(injected).toEqual([message]);
  });

  test("rejects a corrupt journal instead of re-injecting old Messages", () => {
    writeFileSync(path, "{broken");

    expect(() => new DeliveredMessageStore(path)).toThrow();
  });
});
