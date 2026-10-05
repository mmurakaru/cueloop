import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { DaemonServer } from "./server";
import { DaemonClient } from "./client";
import { connectOwnerSdk, connectReviewSdk } from "./daemon-sdk";
import { CueloopSdk } from "./daemon-sdk-effect";

import { createTestSdkHarness } from "../../../test/helpers/sdk-harness";

test("SDK accepts once, waits for its own submission and cancelling a wait preserves work", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sdk-"));
  const harness = createTestSdkHarness();
  const server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: { enabled: true, adapter: harness.adapter },
  });
  server.start();
  const sdk = await connectOwnerSdk({ home });

  try {
    const thread = await sdk.threads.create({
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Explain this", meta: {} },
    });
    const input = {
      threadId: thread.id,
      operationId: sdk.ids.operation("ask-once"),
      text: "Explain",
    };
    const accepted = await sdk.agents.prompt(input);
    const duplicate = await sdk.agents.prompt(input);
    expect(duplicate).toEqual(accepted);
    expect((await sdk.agents.get(thread.id)).submissions).toHaveLength(1);
    await expect(sdk.agents.prompt({ ...input, text: "Different" })).rejects.toMatchObject({
      code: "operation_conflict",
    });
    const cancel = new AbortController();
    const abandonedWait = sdk.agents.wait(accepted, { signal: cancel.signal });
    cancel.abort();
    await expect(abandonedWait).rejects.toMatchObject({ kind: "cancelled" });
    expect(harness.cancelled()).toBe(0);
    const completed = sdk.agents.wait(accepted);
    harness.complete();
    expect((await completed).outcome).toBe("completed");
    const message = {
      threadId: thread.id,
      operationId: sdk.ids.operation("approve-once"),
      outcome: "approved" as const,
      summary: "Good",
    };
    const sent = await sdk.sessions.sendMessage(message);
    expect(await sdk.sessions.sendMessage(message)).toEqual(sent);
  } finally {
    sdk.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("Effect scope supports review comments and typed owner-only capabilities", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sdk-effect-"));
  const server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();

  try {
    const program = Effect.gen(function* () {
      const sdk = yield* CueloopSdk;
      const thread = yield* sdk.threads.create({
        workspace: { repoRoot: home, branch: "main" },
        artifact: { type: "plan", content: "Discuss this", meta: {} },
      });
      const snapshots = yield* sdk.threads.watch(thread.id).pipe(Stream.take(1), Stream.runCollect);
      expect(snapshots[0]?.id).toBe(thread.id);
      const client = yield* Effect.promise(() => DaemonClient.connect({ home }));
      try {
        yield* Effect.promise(() =>
          client.sessionComment(thread.id, {
            id: "comment",
            kind: "comment",
            anchor: { quote: "Discuss", prefix: "", suffix: " this" },
            body: "Why?",
          }),
        );
      } finally {
        client.close();
      }
      yield* sdk.comments.reply({
        threadId: thread.id,
        commentId: "comment",
        body: "Because",
        replyId: "reply",
      });
      const comments = yield* sdk.comments.list(thread.id);
      expect(comments.at(-1)).toMatchObject({ id: "reply", replyTo: "comment", body: "Because" });

      return thread.id;
    });
    const id = await Effect.runPromise(
      program.pipe(Effect.provide(CueloopSdk.ownerLayer({ home }))),
    );
    const review = await connectReviewSdk({ home, role: "agent", author: "review-agent" });
    try {
      expect((await review.threads.get(id)).id).toBe(id);
      expect("agents" in review).toBe(false);
      const capped = await DaemonClient.connect({ home, role: "agent", author: "review-agent" });
      try {
        await expect(capped.agentPrompt({ id, text: "Forbidden" })).rejects.toMatchObject({
          code: "forbidden",
        });
      } finally {
        capped.close();
      }
    } finally {
      review.close();
    }
  } finally {
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("lost response after message commit is uncertain and an explicit retry survives server restart", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sdk-lost-response-"));
  let server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  const connection = await DaemonClient.connect({ home });

  try {
    const thread = await connection.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Approve this", meta: {} },
    );
    const send = server.core.sessionSendMessage.bind(server.core);
    server.core.sessionSendMessage = (...args) => {
      const result = send(...args);
      connection.close();

      return result;
    };
    await expect(
      connection.sessionSendMessage(thread.id, "approved", "Done", undefined, "lost-ack"),
    ).rejects.toMatchObject({ kind: "connection", certainty: "unknown" });
    const original = server.core.sessionGet(thread.id).message;
    server.stop();
    server = new DaemonServer({ home, idleExitMs: 0 });
    server.start();
    const sdk = await connectOwnerSdk({ home });
    try {
      expect(
        await sdk.sessions.sendMessage({
          threadId: sdk.ids.thread(thread.id),
          operationId: sdk.ids.operation("lost-ack"),
          outcome: "approved",
          summary: "Done",
        }),
      ).toEqual(original!);
      expect(
        (await sdk.threads.get(sdk.ids.thread(thread.id))).history?.entries.filter(
          (entry) => entry.type === "message",
        ),
      ).toHaveLength(1);
    } finally {
      sdk.close();
    }
  } finally {
    connection.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("Effect interruption aborts the completion wait without stopping the harness", async () => {
  const { Fiber } = await import("effect");
  const home = mkdtempSync(join(tmpdir(), "cueloop-sdk-interrupt-"));
  const harness = createTestSdkHarness();
  const server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: { enabled: true, adapter: harness.adapter },
  });
  server.start();

  try {
    const program = Effect.gen(function* () {
      const sdk = yield* CueloopSdk;
      const thread = yield* sdk.threads.create({
        workspace: { repoRoot: home, branch: "main" },
        artifact: { type: "plan", content: "Explain", meta: {} },
      });
      const accepted = yield* sdk.agents.prompt({
        threadId: thread.id,
        operationId: sdk.ids.operation("interrupt"),
        text: "Explain",
      });
      const fiber = yield* Effect.forkChild(sdk.agents.wait(accepted));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      expect(harness.cancelled()).toBe(0);
      yield* Effect.sync(() => harness.complete());
      const completed = yield* sdk.agents.wait(accepted);
      expect(completed.outcome).toBe("completed");
    });
    await Effect.runPromise(program.pipe(Effect.provide(CueloopSdk.ownerLayer({ home }))));
  } finally {
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("lost prompt acknowledgement replays original acceptance after restart without a harness", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sdk-lost-prompt-"));
  const harness = createTestSdkHarness();
  let server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: { enabled: true, adapter: harness.adapter },
  });
  server.start();
  const connection = await DaemonClient.connect({ home });

  try {
    const thread = await connection.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Explain", meta: {} },
    );
    await connection.subscribe();
    connection.onEvent((event) => {
      if (event.event === "agent.updated") connection.close();
    });
    await expect(
      connection.agentPrompt({ id: thread.id, text: "Once", operationId: "lost-prompt" }),
    ).rejects.toMatchObject({ kind: "connection", certainty: "unknown" });
    const inspect = await DaemonClient.connect({ home });
    const accepted = await inspect.agentGet(thread.id);
    inspect.close();
    server.stop();
    server = new DaemonServer({ home, idleExitMs: 0, threadAgent: { enabled: true } });
    server.start();
    const sdk = await connectOwnerSdk({ home });
    try {
      const replay = await sdk.agents.prompt({
        threadId: sdk.ids.thread(thread.id),
        operationId: sdk.ids.operation("lost-prompt"),
        text: "Once",
      });
      expect(replay.submissionIds).toEqual(
        accepted.promptOperations![0]!.result.map(sdk.ids.submission),
      );
      expect((await sdk.agents.get(sdk.ids.thread(thread.id))).submissions).toHaveLength(1);
      expect((await sdk.agents.wait(replay)).outcome).toBe("failed");
    } finally {
      sdk.close();
    }
  } finally {
    connection.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("SDK identity types distinguish Thread, operation, and submission capabilities", () => {
  type ThreadId = import("./daemon-sdk").SdkThreadId;
  type OperationId = import("./daemon-sdk").SdkOperationId;
  type SubmissionId = import("./daemon-sdk").SdkSubmissionId;
  type Review = import("./daemon-sdk").ReviewDaemonSdk;
  const operationIsThread: OperationId extends ThreadId ? true : false = false;
  const submissionIsOperation: SubmissionId extends OperationId ? true : false = false;
  const reviewHasAgent: "agents" extends keyof Review ? true : false = false;
  const reviewCreatesThread: "create" extends keyof Review["threads"] ? true : false = false;

  expect([operationIsThread, submissionIsOperation, reviewHasAgent, reviewCreatesThread]).toEqual([
    false,
    false,
    false,
    false,
  ]);
});
