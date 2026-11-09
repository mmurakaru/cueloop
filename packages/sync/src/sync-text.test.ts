import * as Y from "yjs";
import { expect, test } from "bun:test";
import {
  createSyncTextDocument,
  createSyncTextState,
  mergeSyncTextUpdate,
  mapSyncTextPosition,
} from "./sync-text.ts";

test("concurrent text edits converge in either acceptance order and duplicate delivery is harmless", () => {
  const initial = createSyncTextState("Plan\n");
  const alice = createSyncTextDocument({ state: initial.state, canEdit: () => true });
  const bob = createSyncTextDocument({ state: initial.state, canEdit: () => true });

  try {
    const first = alice.edit({ index: 0, deleteCount: 0, insert: "Alice " });
    const second = bob.edit({ index: 4, deleteCount: 0, insert: " and Bob" });
    const acceptedFirst = mergeSyncTextUpdate({ state: initial.state, update: first.update });
    const acceptedBoth = mergeSyncTextUpdate({ state: acceptedFirst.state, update: second.update });
    const reverseFirst = mergeSyncTextUpdate({ state: initial.state, update: second.update });
    const reverseBoth = mergeSyncTextUpdate({ state: reverseFirst.state, update: first.update });

    expect(acceptedBoth.text).toBe("Alice Plan and Bob\n");
    expect(reverseBoth.text).toBe(acceptedBoth.text);
    expect(mergeSyncTextUpdate({ state: acceptedBoth.state, update: first.update }).text).toBe(
      acceptedBoth.text,
    );
    alice.receive(acceptedBoth.state);
    bob.receive(acceptedBoth.state);
    expect(alice.snapshot.text).toBe(acceptedBoth.text);
    expect(bob.snapshot.text).toBe(acceptedBoth.text);
  } finally {
    alice.close();
    bob.close();
  }
});

test("a disconnected text edit retains the accepted document and requires an explicit retry", () => {
  let connected = true;
  const document = createSyncTextDocument({
    state: createSyncTextState("Saved").state,
    canEdit: () => connected,
  });

  try {
    connected = false;
    expect(() => document.replace("Offline draft")).toThrow("retain the change as a draft");
    expect(document.snapshot.text).toBe("Saved");
    connected = true;
    expect(document.snapshot.text).toBe("Saved");
    expect(document.replace("Explicit retry").text).toBe("Explicit retry");
  } finally {
    document.close();
  }
});

test("text replacement preserves Unicode characters and rejects a split surrogate pair", () => {
  const document = createSyncTextDocument({
    state: createSyncTextState("A😀B").state,
    canEdit: () => true,
  });

  try {
    expect(() => document.edit({ index: 2, deleteCount: 0, insert: "x" })).toThrow("Unicode");
    expect(document.snapshot.text).toBe("A😀B");
    const changed = document.replace("A😃B");

    expect(changed.text).toBe("A😃B");
    expect(
      mergeSyncTextUpdate({ state: createSyncTextState("").state, update: changed.state }).text,
    ).toBe("A😃B");
  } finally {
    document.close();
  }
});

test("an edit cannot be accepted before the changes it depends on", () => {
  const initial = createSyncTextState("Plan");
  const document = createSyncTextDocument({ state: initial.state, canEdit: () => true });

  try {
    const first = document.edit({ index: 4, deleteCount: 0, insert: " one" });
    const second = document.edit({ index: 8, deleteCount: 0, insert: " two" });

    expect(() => mergeSyncTextUpdate({ state: initial.state, update: second.update })).toThrow(
      "missing document changes",
    );
    const accepted = mergeSyncTextUpdate({ state: initial.state, update: first.update });

    expect(mergeSyncTextUpdate({ state: accepted.state, update: second.update }).text).toBe(
      "Plan one two",
    );
  } finally {
    document.close();
  }
});

test("an update over the byte budget leaves the editor's last text intact", () => {
  const document = createSyncTextDocument({
    state: createSyncTextState("Saved").state,
    canEdit: () => true,
  });

  try {
    expect(() => document.replace("😀".repeat(40000))).toThrow("update byte budget");
    expect(document.snapshot.text).toBe("Saved");
    expect(document.replace("Recovered").text).toBe("Recovered");
  } finally {
    document.close();
  }
});

test.each(["hidden-root", "formatting", "embedded-value"] as const)(
  "plain shared text rejects a %s update",
  (variant) => {
    const source = new Y.Doc();

    try {
      source.getText("content").insert(0, "Saved");
      const initial = btoa(String.fromCharCode(...Y.encodeStateAsUpdate(source)));

      if (variant === "hidden-root") source.getMap("hidden").set("unexpected", "value");
      else if (variant === "formatting") source.getText("content").format(0, 5, { bold: true });
      else source.getText("content").insertEmbed(0, { unexpected: "value" });

      const update = btoa(String.fromCharCode(...Y.encodeStateAsUpdate(source)));

      expect(() => mergeSyncTextUpdate({ state: initial, update })).toThrow();
      const unchanged = createSyncTextDocument({ state: initial, canEdit: () => false });

      try {
        expect(unchanged.snapshot.text).toBe("Saved");
      } finally {
        unchanged.close();
      }
    } finally {
      source.destroy();
    }
  },
);

test("a draft exports one update against its saved base without replacing concurrent accepted text", () => {
  const initial = createSyncTextState("Plan");
  const draft = createSyncTextDocument({ state: initial.state, canEdit: () => true });
  const collaborator = createSyncTextDocument({ state: initial.state, canEdit: () => true });

  try {
    draft.edit({ index: 4, deleteCount: 0, insert: " one" });
    draft.edit({ index: 8, deleteCount: 0, insert: " two" });
    const remote = collaborator.edit({ index: 0, deleteCount: 0, insert: "Shared " });
    const accepted = mergeSyncTextUpdate({ state: initial.state, update: remote.update });
    const combined = mergeSyncTextUpdate({
      state: accepted.state,
      update: draft.updateSince(initial.state),
    });

    expect(combined.text).toBe("Shared Plan one two");
    expect(draft.snapshot.text).toBe("Plan one two");
  } finally {
    draft.close();
    collaborator.close();
  }
});

test("a text position remains attached when another collaborator inserts before it", () => {
  const initial = createSyncTextState("Plan");
  const collaborator = createSyncTextDocument({ state: initial.state, canEdit: () => true });

  try {
    const changed = collaborator.edit({ index: 0, deleteCount: 0, insert: "Shared " });

    expect(
      mapSyncTextPosition({ fromState: initial.state, toState: changed.state, index: 2 }),
    ).toBe(9);
    expect(
      mapSyncTextPosition({ fromState: initial.state, toState: changed.state, index: 100 }),
    ).toBeUndefined();
  } finally {
    collaborator.close();
  }
});
