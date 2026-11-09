import { expect, test } from "bun:test";
import {
  createSyncTextState,
  createSyncTextDocument,
  createSyncTextPosition,
  resolveSyncTextPosition,
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
