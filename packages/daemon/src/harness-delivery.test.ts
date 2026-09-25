import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonCore } from "./api";
import { harnessStatePath } from "./paths";

let home: string;
let cores: DaemonCore[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-harness-delivery-"));
  cores = [];
});

afterEach(() => {
  for (const core of cores) core.dispose();
  rmSync(home, { recursive: true, force: true });
});

function core(): DaemonCore {
  const instance = new DaemonCore(home);

  cores.push(instance);

  return instance;
}

function createPlan(instance: DaemonCore) {
  return instance.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan", meta: {} },
  });
}

describe("durable harness delivery", () => {
  test("delivers Comment without resolving the Thread", () => {
    const instance = core();
    const thread = createPlan(instance);
    const binding = instance.harnessBind({
      threadId: thread.id,
      harness: "fake",
      harnessSessionId: "fake_1",
    });

    const sent = instance.sessionSendMessage(thread.id, "comment", "Interim note.");
    const pending = instance.deliveryPending(binding.id);

    expect(sent.status).toBe("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.message.outcome).toBe("comment");
  });

  test("reload finds only bindings for the active harness conversation", () => {
    const first = core();
    const thread = createPlan(first);
    const current = first.harnessBind({
      threadId: thread.id,
      harness: "pi",
      harnessSessionId: "pi-current",
    });

    first.harnessBind({ threadId: thread.id, harness: "pi", harnessSessionId: "pi-other" });
    first.harnessBind({ threadId: thread.id, harness: "codex", harnessSessionId: "pi-current" });

    expect(core().harnessBindingsForSession("pi", "pi-current")).toEqual([current]);
  });

  test("redelivers after reload until the harness acknowledges the Message", () => {
    const first = core();
    const thread = createPlan(first);
    const binding = first.harnessBind({
      threadId: thread.id,
      harness: "fake",
      harnessSessionId: "fake_1",
    });
    const sent = first.sessionSendMessage(thread.id, "changes_requested", "Add detail.");
    const initial = first.deliveryPending(binding.id);

    expect(initial).toHaveLength(1);
    expect(initial[0]!.message).toEqual(sent.message!);

    const reloaded = core();
    const redelivered = reloaded.deliveryPending(binding.id);

    expect(redelivered).toEqual(initial);
    reloaded.deliveryAcknowledge(redelivered[0]!.delivery.id);

    expect(core().deliveryPending(binding.id)).toEqual([]);
  });

  test("retains an expired Thread until its pending Message is acknowledged", () => {
    const first = core();
    const thread = createPlan(first);
    const binding = first.harnessBind({
      threadId: thread.id,
      harness: "fake",
      harnessSessionId: "fake_1",
    });

    first.sessionSendMessage(thread.id, "approved", "Ready.");
    const oldThread = first.sessionGet(thread.id);

    first.store.upsert({ ...oldThread, createdAt: "2020-01-01T00:00:00.000Z" });

    const reloaded = core();
    const delivery = reloaded.deliveryPending(binding.id)[0];

    expect(delivery?.message.body).toContain("Ready.");
    reloaded.deliveryAcknowledge(delivery!.delivery.id);

    expect(core().store.get(thread.id)).toBeUndefined();
  });

  test("rebuilds a delivery if the Thread saved its Message before enqueue", () => {
    const first = core();
    const thread = createPlan(first);
    const binding = first.harnessBind({
      threadId: thread.id,
      harness: "fake",
      harnessSessionId: "fake_1",
    });
    const sent = first.sessionSendMessage(thread.id, "approved", "Ready.");
    first.store.upsert({
      ...first.sessionGet(thread.id),
      createdAt: "2020-01-01T00:00:00.000Z",
    });

    writeFileSync(harnessStatePath(home), JSON.stringify({ bindings: [binding], deliveries: [] }));

    const recovered = core().deliveryPending(binding.id);

    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.message).toEqual(sent.message!);
  });

  test("routes an approved retry as a new Message", () => {
    const instance = core();
    const thread = createPlan(instance);
    const binding = instance.harnessBind({
      threadId: thread.id,
      harness: "fake",
      harnessSessionId: "fake_1",
    });

    instance.sessionSendMessage(thread.id, "changes_requested", "Try once more.");
    const first = instance.deliveryPending(binding.id)[0]!;

    instance.deliveryAcknowledge(first.delivery.id);
    instance.sessionSubmitRevision(thread.id, "# Plan");
    instance.sessionSendMessage(thread.id, "approved", "Ready.");
    const retry = instance.deliveryPending(binding.id);

    expect(retry).toHaveLength(1);
    expect(retry[0]!.message.outcome).toBe("approved");
    expect(retry[0]!.message.id).not.toBe(first.message.id);
  });

  test("keeps an older pending Message available after a Thread revision", () => {
    const instance = core();
    const thread = createPlan(instance);
    const binding = instance.harnessBind({
      threadId: thread.id,
      harness: "fake",
      harnessSessionId: "fake_1",
    });

    instance.sessionSendMessage(thread.id, "changes_requested", "Add detail.");
    const first = instance.deliveryPending(binding.id)[0]!;

    instance.sessionSubmitRevision(thread.id, "# Revised plan");
    instance.sessionSendMessage(thread.id, "approved", "Ready.");

    const pending = core().deliveryPending(binding.id);

    expect(pending.map((item) => item.message.id)).toEqual([first.message.id, expect.any(String)]);
    expect(pending[0]!.message.body).toBe(first.message.body);
  });

  test("defaults delivery to the submitting binding only", () => {
    const instance = core();
    const thread = createPlan(instance);
    const submitter = instance.harnessBind({
      threadId: thread.id,
      harness: "fake",
      harnessSessionId: "fake_1",
    });
    const other = instance.harnessBind({
      threadId: thread.id,
      harness: "other",
      harnessSessionId: "other_1",
    });

    instance.sessionSendMessage(thread.id, "approved", "Ready.");

    expect(instance.deliveryPending(submitter.id)).toHaveLength(1);
    expect(instance.deliveryPending(other.id)).toEqual([]);
  });

  test("consumes the unchanged approved retry once across daemon reload", () => {
    const instance = core();
    const thread = createPlan(instance);
    const binding = instance.harnessBind({
      threadId: thread.id,
      harness: "fake",
      harnessSessionId: "fake_1",
    });
    const sent = instance.sessionSendMessage(thread.id, "approved", "Ready.");
    const messageId = sent.message!.id;

    expect(() => instance.harnessConsumeApprovedRetry(binding.id, messageId, "# Plan")).toThrow(
      "no unchanged approved plan",
    );

    const delivery = instance.deliveryPending(binding.id)[0]!.delivery;

    instance.deliveryAcknowledge(delivery.id);

    expect(instance.harnessConsumeApprovedRetry(binding.id, messageId, "# Plan")).toBe(true);
    expect(core().harnessConsumeApprovedRetry(binding.id, messageId, "# Plan")).toBe(false);
    expect(() => core().harnessConsumeApprovedRetry(binding.id, messageId, "# Changed")).toThrow(
      "no unchanged approved plan",
    );
  });
});
