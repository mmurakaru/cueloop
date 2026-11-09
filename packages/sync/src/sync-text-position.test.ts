import * as Y from "yjs";
import { expect, test } from "bun:test";
import {
  createSyncTextState,
  createSyncTextDocument,
  createSyncTextPosition,
  resolveSyncTextPosition,
  resolveSyncTextPositions,
} from "./sync-text.ts";

test("serialized selections follow accepted text and invalidate missing document items", () => {
  const initial = createSyncTextState("Plan 世界 🌍");
  const editor = createSyncTextDocument({ state: initial.state, canEdit: () => true });
  const position = createSyncTextPosition({ state: initial.state, index: 7 });

  try {
    editor.edit({ index: 0, deleteCount: 0, insert: "Shared " });
    expect(resolveSyncTextPosition({ state: editor.snapshot.state, position })).toBe(14);
    expect(
      resolveSyncTextPosition({ state: createSyncTextState("Unrelated").state, position }),
    ).toBeUndefined();
    expect(
      resolveSyncTextPosition({ state: editor.snapshot.state, position: "bad!" }),
    ).toBeUndefined();
  } finally {
    editor.close();
  }
});

test("an open editor creates and resolves positions through later text changes", () => {
  const document = createSyncTextDocument({
    state: createSyncTextState("Plan 世界 🌍").state,
    canEdit: () => true,
  });

  try {
    const positions = [
      document.createPosition({ index: 0, association: 0 }),
      document.createPosition({ index: 4 }),
    ];

    document.edit({ index: 0, deleteCount: 0, insert: "Shared " });
    expect(document.resolvePositions([...positions, "bad!"])).toEqual([7, 11, undefined]);
    expect(resolveSyncTextPositions({ state: document.snapshot.state, positions })).toEqual([
      7, 11,
    ]);
    document.close();
    expect(() => document.createPosition({ index: 0 })).toThrow("Sync text document is closed");
  } finally {
    document.close();
  }
});

test("an unknown relative-position root cannot change the open editor document", () => {
  const document = createSyncTextDocument({
    state: createSyncTextState("Plan").state,
    canEdit: () => true,
  });
  const position = btoa(
    String.fromCharCode(...Y.encodeRelativePosition(new Y.RelativePosition(null, "other", null))),
  );

  try {
    expect(document.resolvePositions([position])).toEqual([undefined]);
    document.edit({ index: 4, deleteCount: 0, insert: " updated" });
    expect(document.snapshot.text).toBe("Plan updated");
  } finally {
    document.close();
  }
});
