import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { EntryId, EntryRecord, SnapshotEvent } from "@earendil-works/pi-durable";
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

function createTestSnapshot(partial: string): SnapshotEvent {
  return {
    type: "snapshot",
    entries: [],
    generation: { attempt: 2, message: fauxAssistantMessage(partial) },
    tools: [],
    compactions: [],
    inbox: [],
    agent: {},
    usage: { tools: {}, models: {} },
  };
}

test("a retry snapshot replaces partial text and final entries do not duplicate streamed text", () => {
  // SAFETY: The fixture input ID is a positive Pi record identity.
  const projection = new PiAnswerProjection(1 as EntryId);

  projection.restore(
    [createTestEntry(2, "Earlier tool round. ")],
    createTestSnapshot("Failed attempt"),
  );
  expect(projection.text()).toBe("Earlier tool round. Failed attempt");
  projection.restore([createTestEntry(2, "Earlier tool round. ")], createTestSnapshot("Retried"));
  expect(projection.text()).toBe("Earlier tool round. Retried");
  projection.apply({ type: "message_end", entry: createTestEntry(3, "Retried") });
  expect(projection.text()).toBe("Earlier tool round. Retried");
  projection.apply({ type: "message_end", entry: createTestEntry(3, "Retried") });
  expect(projection.text()).toBe("Earlier tool round. Retried");
});

test("a replacement message and block update overwrite partial output instead of appending it", () => {
  // SAFETY: The fixture input ID is a positive Pi record identity.
  const projection = new PiAnswerProjection(1 as EntryId);
  const message = fauxAssistantMessage("Original");

  projection.apply({ type: "message_start", message });
  projection.apply({
    type: "message_update",
    usage: message.usage,
    changes: [{ type: "message", message: fauxAssistantMessage("Replacement") }],
  });
  expect(projection.text()).toBe("Replacement");
  projection.apply({
    type: "message_update",
    usage: message.usage,
    changes: [{ type: "block", contentIndex: 0, block: { type: "text", text: "Final" } }],
  });
  expect(projection.text()).toBe("Final");
});
