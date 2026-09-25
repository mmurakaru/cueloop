import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessStateStore } from "./harness-state-store";
import { harnessStatePath } from "./paths";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-harness-state-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("HarnessStateStore", () => {
  test("redelivers an unacknowledged Message after reload", () => {
    const store = new HarnessStateStore(home);
    const binding = store.bind({
      threadId: "ses_1",
      harness: "fake",
      harnessSessionId: "fake_1",
    });
    const delivery = store.enqueue({ bindingId: binding.id, messageId: "msg_1" });

    expect(store.pending(binding.id)).toEqual([delivery]);

    const reloaded = new HarnessStateStore(home);

    expect(reloaded.pending(binding.id)).toEqual([delivery]);
  });

  test("does not redeliver an acknowledged Message", () => {
    const store = new HarnessStateStore(home);
    const binding = store.bind({
      threadId: "ses_1",
      harness: "fake",
      harnessSessionId: "fake_1",
    });
    const delivery = store.enqueue({ bindingId: binding.id, messageId: "msg_1" });

    store.acknowledge(delivery.id, "2026-09-20T20:00:00.000Z");

    expect(new HarnessStateStore(home).pending(binding.id)).toEqual([]);
  });

  test("reuses the binding for the same harness session and thread", () => {
    const store = new HarnessStateStore(home);
    const input = {
      threadId: "ses_1",
      harness: "fake",
      harnessSessionId: "fake_1",
    };

    expect(store.bind(input)).toEqual(store.bind(input));
  });

  test("does not discard pending deliveries when persisted state is corrupt", () => {
    writeFileSync(harnessStatePath(home), "{broken");

    expect(() => new HarnessStateStore(home)).toThrow();
  });
});
