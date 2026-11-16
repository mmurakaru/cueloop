import { expect, test } from "bun:test";
import type { EntryId, EntryRecord, LiveState } from "@earendil-works/pi-durable";
import { PiToolProjection } from "./tool-projection";

function createTestToolEntry(id: number): EntryRecord {
  // SAFETY: Positive fixture IDs use Pi's numeric record identity namespace.
  return {
    id: id as EntryId,
    conversationId: 1 as EntryRecord["conversationId"],
    kind: "tool",
    model: [
      {
        role: "toolResult",
        toolCallId: "read-1",
        toolName: "read",
        isError: false,
        content: [],
        timestamp: 0,
      },
    ],
  };
}

function createTestRunningTool(): LiveState {
  return { tools: [{ callId: "read-1", name: "read", status: "running" }] };
}

test("tool state changes publish once and a committed result completes the tool after its live slot clears", () => {
  const projection = new PiToolProjection();
  const input = createTestToolEntry(1).id;

  expect(projection.restore([], createTestRunningTool(), input)).toEqual([
    { kind: "tool", id: "read-1", title: "read", status: "in_progress" },
  ]);
  expect(projection.restore([], createTestRunningTool(), input)).toEqual([]);
  expect(projection.restore([createTestToolEntry(2)], undefined, input)).toEqual([
    { kind: "tool", id: "read-1", title: "read", status: "completed" },
  ]);
  expect(projection.restore([createTestToolEntry(2)], undefined, input)).toEqual([]);
});

test("a running tool that disappears without a result fails instead of staying active", () => {
  const projection = new PiToolProjection();
  const input = createTestToolEntry(1).id;

  projection.restore([], createTestRunningTool(), input);
  expect(projection.restore([], undefined, input)).toEqual([
    { kind: "tool", id: "read-1", title: "read", status: "failed" },
  ]);
});

test("tools before the admitted input do not replay into its answer", () => {
  const projection = new PiToolProjection();

  expect(
    projection.restore([createTestToolEntry(1)], undefined, createTestToolEntry(2).id),
  ).toEqual([]);
});
