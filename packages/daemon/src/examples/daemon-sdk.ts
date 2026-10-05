import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { CueloopSdk } from "../daemon-sdk-effect";

const reviewConversation = Effect.gen(function* () {
  const sdk = yield* CueloopSdk;
  const thread = yield* sdk.threads.create({
    workspace: { repoRoot: process.cwd(), branch: "main" },
    artifact: { type: "plan", content: "Review this proposal.", meta: { title: "SDK example" } },
  });

  yield* sdk.threads.get(thread.id);
  yield* sdk.comments.add({
    threadId: thread.id,
    annotation: {
      id: "question",
      kind: "comment",
      body: "Explain the proposal",
      anchor: { quote: "proposal", prefix: "Review this ", suffix: "." },
    },
  });
  const accepted = yield* sdk.agents.prompt({
    threadId: thread.id,
    operationId: sdk.ids.operation(randomUUID()),
    text: "Explain this Thread and its comment.",
  });
  const completed = yield* sdk.agents.wait(accepted, { timeoutMs: 300_000 });

  if (completed.outcome !== "completed")
    throw new Error(`SDK example agent finished: ${completed.outcome}`);
  const comments = yield* sdk.comments.list(thread.id);

  if (comments[0])
    yield* sdk.comments.reply({
      threadId: thread.id,
      commentId: comments[0].id,
      body: "The explanation is clear.",
    });
  yield* sdk.sessions.sendMessage({
    threadId: thread.id,
    operationId: sdk.ids.operation(randomUUID()),
    outcome: "approved",
    summary: "Review complete",
  });

  return thread.id;
});

if (import.meta.main) {
  const threadId = await Effect.runPromise(
    reviewConversation.pipe(Effect.provide(CueloopSdk.ownerLayer({ autostart: true }))),
  );

  console.log(`Thread approved: ${threadId}`);
}
