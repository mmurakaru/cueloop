/** The prompt dialog's footer actions are mouse-clickable: clicking "save" commits and "cancel"
 * dismisses, the same as pressing enter or esc. */

import { test, expect } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { PromptDialog } from "./PromptDialog";
import { locateText, settle, typeText } from "../test-support";
import { DARK } from "../theme";

test("the input is focused on open, so typing lands in the dialog", async () => {
  const inputs: string[] = [];
  const setup = await testRender(
    <PromptDialog
      isOpen
      title=" rename thread "
      label="new title for this thread:"
      value="hi"
      onInput={(text) => inputs.push(text)}
      theme={DARK}
    />,
    { width: 60, height: 12 },
  );
  await settle(setup);

  await typeText(setup, "!");
  expect(inputs.at(-1)).toBe("hi!");

  setup.renderer.destroy();
});

test("clicking save fires onSave and clicking cancel fires onCancel", async () => {
  let saved = 0;
  let cancelled = 0;
  const setup = await testRender(
    <PromptDialog
      isOpen
      title=" rename thread "
      label="new title for this thread:"
      value="a title"
      onInput={() => {}}
      onSave={() => (saved += 1)}
      onCancel={() => (cancelled += 1)}
      theme={DARK}
    />,
    { width: 60, height: 12 },
  );
  await settle(setup);

  const save = locateText(setup, "save");
  await setup.mockMouse.click(save.column, save.row);
  expect(saved).toBe(1);
  expect(cancelled).toBe(0);

  const cancel = locateText(setup, "cancel");
  await setup.mockMouse.click(cancel.column, cancel.row);
  expect(cancelled).toBe(1);
  expect(saved).toBe(1);

  setup.renderer.destroy();
});
