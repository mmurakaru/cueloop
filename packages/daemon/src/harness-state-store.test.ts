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

  test("deletes every harness binding and delivery for a Thread", () => {
    const store = new HarnessStateStore(home);
    const bindings = ["pi", "codex", "claude-code"].map((harness) =>
      store.bind({ threadId: "ses_1", harness, harnessSessionId: `${harness}_1` }),
    );
    const deliveries = bindings.map((binding, index) =>
      store.enqueue({ bindingId: binding.id, messageId: `msg_${index}` }),
    );

    expect(store.deleteThreadState("ses_1")).toBeTrue();
    expect(store.deleteThreadState("ses_1")).toBeFalse();
    const reloaded = new HarnessStateStore(home);

    for (const binding of bindings) expect(reloaded.binding(binding.id)).toBeNull();
    for (const delivery of deliveries) expect(reloaded.delivery(delivery.id)).toBeNull();
  });

  test("deletes state for Threads missing at startup", () => {
    const store = new HarnessStateStore(home);

    store.bind({ threadId: "ses_kept", harness: "pi", harnessSessionId: "pi_1" });
    store.bind({ threadId: "ses_orphan", harness: "codex", harnessSessionId: "codex_1" });

    expect(store.deleteOrphanedThreadState(new Set(["ses_kept"]))).toEqual(["ses_orphan"]);
    expect(store.bindingsForSession("pi", "pi_1")).toHaveLength(1);
    expect(store.bindingsForSession("codex", "codex_1")).toEqual([]);
  });

  test("does not discard pending deliveries when persisted state is corrupt", () => {
    writeFileSync(harnessStatePath(home), "{broken");

    expect(() => new HarnessStateStore(home)).toThrow();
  });
});
