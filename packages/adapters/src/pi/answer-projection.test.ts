import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { EntryId, EntryRecord, LiveState } from "@earendil-works/pi-durable";
import { PiAnswerProjection } from "./answer-projection";

function createTestEntry(id: number, text: string): EntryRecord {
  // SAFETY: Positive fixture IDs use Pi's numeric record identity namespace.
  return {
    id: id as EntryId,
    conversationId: 1 as EntryRecord["conversationId"],
    kind: "answer",
    model: [fauxAssistantMessage(text)],
  };
}

function createTestLiveState(partial: string): LiveState {
  const { api, provider, model, usage, stopReason, timestamp } = fauxAssistantMessage(partial);

  return {
    generation: {
      attempt: 2,
      message: {
        role: "assistant",
        content: [{ type: "text", text: partial }],
        api,
        provider,
        model,
        usage,
        stopReason,
        timestamp,
      },
    },
  };
}

test("a retry replaces partial text and committed entries do not duplicate streamed text", () => {
  const input = createTestEntry(1, "");
  const projection = new PiAnswerProjection(input.id);

  projection.restore(
    [createTestEntry(2, "Earlier tool round. ")],
    createTestLiveState("Failed attempt"),
  );
  expect(projection.text()).toBe("Earlier tool round. Failed attempt");
  projection.restore([], createTestLiveState("Retried"));
  expect(projection.text()).toBe("Earlier tool round. Retried");
  projection.restore([createTestEntry(3, "Retried")]);
  expect(projection.text()).toBe("Earlier tool round. Retried");
  projection.restore([createTestEntry(3, "Retried")]);
  expect(projection.text()).toBe("Earlier tool round. Retried");
});

test("a structural replacement overwrites partial output without mutating an earlier view", () => {
  const projection = new PiAnswerProjection(createTestEntry(1, "").id);
  const original = createTestLiveState("Original");

  projection.restore([], original);
  expect(projection.text()).toBe("Original");
  projection.restore([], createTestLiveState("Replacement"));
  expect(projection.text()).toBe("Replacement");
  expect(original.generation?.message?.content).toEqual([{ type: "text", text: "Original" }]);
});

test("a moving conversation window retains earlier committed answer rounds", () => {
  const projection = new PiAnswerProjection(createTestEntry(1, "").id);

  projection.restore([createTestEntry(2, "First. ")]);
  projection.restore([createTestEntry(3, "Second. ")], createTestLiveState("Third."));
  expect(projection.text()).toBe("First. Second. Third.");
});

test("a later user input bounds both committed and partial answer output", () => {
  const projection = new PiAnswerProjection(createTestEntry(1, "").id);
  const next: EntryRecord = {
    ...createTestEntry(3, ""),
    model: [{ role: "user", content: "Next question", timestamp: 0 }],
  };

  projection.restore(
    [createTestEntry(2, "First answer"), next],
    createTestLiveState("Next answer"),
  );
  expect(projection.text()).toBe("First answer");
});
