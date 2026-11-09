import { expect, test } from "bun:test";
import React, { useLayoutEffect, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  createSyncTextState,
  createSyncTextDocument,
  mapSyncTextPosition,
} from "@cueloop/sync/text";
import { DARK } from "../../appearance/theme";
import { settle, waitForText } from "../../testing/test-support";
import { MarkdownThreadEditor } from "./MarkdownThreadEditor";

test("a remote insertion preserves a held selection on its original text", async () => {
  const initial = createSyncTextState("Plan");
  const remote = createSyncTextDocument({ state: initial.state, canEdit: () => true });
  let update: ((value: { text: string; state: string }) => void) | undefined;
  const inputs: string[] = [];
  const selections: ({ anchor: number; focus: number } | null)[] = [];

  function Editor() {
    const [snapshot, setSnapshot] = useState(initial);

    useLayoutEffect(() => {
      update = setSnapshot;

      return () => {
        update = undefined;
      };
    }, []);

    return (
      <MarkdownThreadEditor
        initialText="Plan"
        text={snapshot.text}
        theme={DARK}
        mapCursor={(index, association) =>
          mapSyncTextPosition({
            fromState: initial.state,
            toState: snapshot.state,
            index,
            association,
          })
        }
        onSelectionChange={(selection) => selections.push(selection)}
        onTextChange={(text) => inputs.push(text)}
        onExitEditor={() => {}}
      />
    );
  }

  const setup = await testRender(<Editor />, { width: 70, height: 10, kittyKeyboard: true });

  try {
    await settle(setup);
    setup.mockInput.pressKey("END");
    await settle(setup);

    for (const key of ["ARROW_LEFT", "ARROW_LEFT", "ARROW_LEFT", "ARROW_LEFT"]) {
      setup.mockInput.pressKey(key, { shift: true });
      await settle(setup);
    }

    await settle(setup);
    expect(selections.at(-1)).toEqual({ anchor: 0, focus: 4 });
    update?.(remote.edit({ index: 0, deleteCount: 0, insert: "Shared " }));
    await settle(setup);
    expect(selections.at(-1)).toEqual({ anchor: 7, focus: 11 });
    await setup.mockInput.typeText("X");
    await waitForText(setup, "Shared X");
    expect(inputs).toEqual(["Shared X"]);
  } finally {
    setup.renderer.destroy();
    remote.close();
  }
});
