import { expect, test } from "bun:test";
import { generateMasterKey, sealBlob } from "./crypto";
import { MemoryShareStore, WatchedShareStore, SHARE_TTL_MS } from "./store";
import { packSessionBlob } from "@cueloop/daemon/share-blob";
import { SCHEMA_VERSION, type Thread } from "@cueloop/schema";
import { SharedAgentRelay } from "./shared-agent";

test("offline acceptance survives gateway restart and only the share owner can acknowledge", async () => {
  const store = new WatchedShareStore(new MemoryShareStore());
  const key = generateMasterKey();
  const thread: Thread = {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_relay",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "Review me", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "now",
    shares: [
      { id: "p_12345678", owner: "owner", agentEnabled: true, requireAuth: false, allowlist: [] },
    ],
  };

  await store.put("p_12345678", sealBlob(key, "p_12345678", packSessionBlob(thread)));
  const first = new SharedAgentRelay(store, key);
  const input = { id: thread.id, text: "Explain this", operationId: "request-1" };
  const accepted = await first.prompt("p_12345678", "viewer", input);

  expect(accepted.phase.kind).toBe("offline");
  expect(accepted.messages.at(-1)?.text).toBe("Explain this");
  const second = new SharedAgentRelay(store, key);

  expect((await second.get("p_12345678")).messages).toEqual(accepted.messages);
  expect(await second.prompt("p_12345678", "viewer", input)).toEqual(accepted);
  await expect(
    second.prompt("p_12345678", "viewer", { ...input, text: "Different" }),
  ).rejects.toThrow("conflict");
  await expect(second.attach("p_12345678", "viewer", () => {})).rejects.toThrow("owner");
  let delivered = 0;
  const disconnect = await second.attach("p_12345678", "owner", (frame) => {
    if (frame.type === "requests") delivered = frame.requests.length;
  });

  expect(delivered).toBe(1);
  expect((await second.get("p_12345678")).phase.kind).toBe("idle");
  await disconnect();
  expect((await second.get("p_12345678")).phase.kind).toBe("offline");
});

function createTestRelay() {
  const store = new WatchedShareStore(new MemoryShareStore());
  const key = generateMasterKey();
  const thread: Thread = {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_relay_cases",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "Review me", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "now",
    shares: [
      { id: "p_abcdefgh", owner: "owner", agentEnabled: true, requireAuth: false, allowlist: [] },
    ],
  };
  const relay = new SharedAgentRelay(store, key);
  const save = () => store.put("p_abcdefgh", sealBlob(key, "p_abcdefgh", packSessionBlob(thread)));

  return { relay, thread, save, store, key };
}

test("queued comments freeze individually, retain the author, and ordinary comments remain editable", async () => {
  const { relay, thread, save } = createTestRelay();

  thread.annotations = ["viewer", "owner"].map((author) => ({
    id: author,
    author,
    kind: "comment",
    body: `${author} question`,
    anchor: { quote: "Review", prefix: "", suffix: " me" },
    createdAt: "now",
  }));
  await save();
  const state = await relay.prompt("p_abcdefgh", "viewer", {
    id: thread.id,
    text: "",
    operationId: "viewer-op",
    commentId: "viewer",
  });

  expect(state.submissions?.map((entry) => entry.commentId)).toEqual(["viewer"]);
  expect(await relay.frozen("p_abcdefgh", "viewer")).toBe(true);
  expect(await relay.frozen("p_abcdefgh", "owner")).toBe(false);
  let requests: import("@cueloop/schema").SharedAgentRequest[] = [];
  const send = (frame: import("@cueloop/schema").SharedAgentFrame) => {
    if (frame.type === "requests") requests = frame.requests;
  };
  const detach = await relay.attach("p_abcdefgh", "owner", send);

  expect(requests[0]?.author).toBe("viewer");
  const accepted = requests[0]!.params.operationId;

  await relay.accept(
    "p_abcdefgh",
    "owner",
    {
      ...state,
      phase: { kind: "idle" },
      promptOperations: [
        { operationId: accepted, fingerprint: "receipt", result: [state.submissions![0]!.id] },
      ],
    },
    [accepted],
    send,
  );
  expect((await relay.get("p_abcdefgh")).messages).toHaveLength(1);
  await detach();
  await expect(relay.accept("p_abcdefgh", "owner", state, [accepted], send)).rejects.toThrow(
    "connected owner",
  );
});

test("disabled and revoked shares reject all agent operations without hiding the artifact", async () => {
  const { relay, thread, save, store } = createTestRelay();

  thread.shares![0]!.agentEnabled = false;
  await save();
  await expect(relay.get("p_abcdefgh")).rejects.toThrow("disabled");
  expect(await store.get("p_abcdefgh")).not.toBeNull();
  thread.shares![0]!.agentEnabled = true;
  await save();
  await expect(
    relay.prompt("p_abcdefgh", "viewer", { id: "other-thread", text: "hello", operationId: "bad" }),
  ).rejects.toThrow("this Thread");
  await store.delete("p_abcdefgh");
  await expect(
    relay.prompt("p_abcdefgh", "viewer", { id: thread.id, text: "hello", operationId: "bad" }),
  ).rejects.toThrow("not found");
});

test("an older owner channel cannot publish after reconnect", async () => {
  const { relay, save } = createTestRelay();

  await save();
  const oldSend = () => {};
  const detach = await relay.attach("p_abcdefgh", "owner", oldSend);
  const state = await relay.get("p_abcdefgh");

  await detach();
  const newSend = () => {};
  const stop = await relay.attach("p_abcdefgh", "owner", newSend);

  await expect(relay.accept("p_abcdefgh", "owner", state, [], oldSend)).rejects.toThrow(
    "connected owner",
  );
  await relay.accept("p_abcdefgh", "owner", state, [], newSend);
  await stop();
});

test("admission and annotation writes serialize so accepted input cannot be changed", async () => {
  const { BlobThreadClient } = await import("./blob-thread-client");
  const { relay, thread, save, store, key } = createTestRelay();
  const annotation = {
    id: "comment",
    author: "viewer",
    kind: "comment" as const,
    body: "Accepted text",
    anchor: { quote: "Review", prefix: "", suffix: " me" },
    createdAt: "now",
  };

  thread.annotations = [annotation];
  await save();
  const client = new BlobThreadClient(thread, {
    store,
    masterKey: key,
    shareId: "p_abcdefgh",
    author: "viewer",
    agent: relay,
  });
  const admission = relay.prompt("p_abcdefgh", "viewer", {
    id: thread.id,
    text: "",
    operationId: "frozen-input",
    commentId: "comment",
  });
  const edit = client
    .sessionAnnotate(thread.id, { ...annotation, body: "Changed text" })
    .catch((error: Error) => error);

  await admission;
  expect(await edit).toMatchObject({ message: "Sent agent comments are read-only" });
  expect((await relay.get("p_abcdefgh")).submissions?.[0]?.prompt).toBe("Accepted text");
  let discussion: string | undefined;
  const disconnect = await relay.attach("p_abcdefgh", "owner", (frame) => {
    if (frame.type === "requests") discussion = frame.requests[0]?.params.discussion;
  });

  expect(discussion).toContain("Accepted text");
  await disconnect();
  client.close();
});

test("a continuation prompt leaves ordinary inline comments editable", async () => {
  const { relay, thread, save } = createTestRelay();

  thread.annotations = [
    {
      id: "ordinary",
      author: "viewer",
      kind: "comment",
      body: "Keep this inline",
      anchor: { quote: "Review", prefix: "", suffix: " me" },
      createdAt: "now",
    },
  ];
  await save();
  const state = await relay.prompt("p_abcdefgh", "viewer", {
    id: thread.id,
    text: "Continue",
    operationId: "continuation",
    inputOnly: true,
  });

  expect(state.submissions?.map((entry) => entry.prompt)).toEqual(["Continue"]);
  expect(await relay.frozen("p_abcdefgh", "ordinary")).toBe(false);
});

test("shared agent history lives for the artifact retention window", async () => {
  let now = 0;
  const store = new WatchedShareStore(new MemoryShareStore(() => now));
  const key = generateMasterKey();
  const { thread } = createTestRelay();
  const save = () => store.put("p_abcdefgh", sealBlob(key, "p_abcdefgh", packSessionBlob(thread)));
  const relay = new SharedAgentRelay(store, key);

  await save();
  await relay.prompt("p_abcdefgh", "viewer", {
    id: thread.id,
    text: "Retain this",
    operationId: "retained",
    inputOnly: true,
  });
  now = SHARE_TTL_MS - 1;
  await save();
  now += SHARE_TTL_MS - 1;
  expect((await relay.get("p_abcdefgh")).messages[0]?.text).toBe("Retain this");
  now++;
  await expect(relay.get("p_abcdefgh")).rejects.toThrow("not found");
});
