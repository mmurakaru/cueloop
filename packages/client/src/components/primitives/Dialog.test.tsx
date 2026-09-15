/** The dialog dismisses on a backdrop click (outside the panel) but never on a click inside it. */

import { test, expect } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { Dialog } from "./Dialog";
import { settle } from "../../test-support";
import { DARK } from "../../theme";

test("clicking the backdrop dismisses; clicking inside the panel does not", async () => {
  let dismissed = 0;
  const setup = await testRender(
    <Dialog
      isOpen
      title=" test "
      width={20}
      height={5}
      background={DARK.elevated}
      onDismiss={() => (dismissed += 1)}
      theme={DARK}
    >
      <text>body</text>
    </Dialog>,
    { width: 60, height: 20 },
  );
  await settle(setup);

  // the top-left corner is backdrop, outside the centered panel
  await setup.mockMouse.click(0, 0);
  expect(dismissed).toBe(1);

  // the screen centre lands inside the panel, so it must not dismiss
  await setup.mockMouse.click(30, 10);
  expect(dismissed).toBe(1);

  setup.renderer.destroy();
});
