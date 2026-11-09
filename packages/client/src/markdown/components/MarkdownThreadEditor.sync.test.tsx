import { expect, test } from "bun:test";
import React, { useLayoutEffect, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../../appearance/theme";
import { settle, waitForText } from "../../testing/test-support";
import { MarkdownThreadEditor } from "./MarkdownThreadEditor";

test("external text updates render without being submitted as user input", async () => {
  const inputs: string[] = [];
  let update: ((value: string) => void) | undefined;

  function Editor() {
    const [text, setText] = useState("Plan");

    useLayoutEffect(() => {
      update = setText;

      return () => {
        update = undefined;
      };
    }, []);

    return (
      <MarkdownThreadEditor
        initialText="Plan"
        text={text}
        theme={DARK}
        onExitEditor={() => {}}
        onTextChange={(value) => {
          inputs.push(value);
          setText(value);
        }}
      />
    );
  }
  const setup = await testRender(<Editor />, { width: 60, height: 10 });

  try {
    await settle(setup);
    await setup.mockInput.typeText("x");
    await waitForText(setup, "xPlan");
    expect(inputs).toEqual(["xPlan"]);
    update?.("Shared xPlan");
    await settle(setup);
    await waitForText(setup, "Shared xPlan");
    expect(inputs).toEqual(["xPlan"]);
  } finally {
    setup.renderer.destroy();
  }
});
