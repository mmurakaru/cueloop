import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ThreadTree } from "./ThreadTree";
import { TooltipProvider } from "../../ui/components/Tooltip";
import { locateText, waitForText } from "../../testing/test-support";

test("New Thread button sits beside Threads and exposes its hover tooltip", async () => {
  let created = 0;
  const setup = await testRender(
    <TooltipProvider>
      <ThreadTree rows={[]} cursor={0} onCreateThread={() => created++} />
    </TooltipProvider>,
    { width: 30, height: 8 },
  );

  try {
    await waitForText(setup, "Threads");
    const button = locateText(setup, "+");
    const heading = locateText(setup, "Threads");

    expect(button.row).toBe(heading.row);
    await setup.mockMouse.moveTo(button.column, button.row);
    await waitForText(setup, "New Thread");
    await setup.mockMouse.click(button.column, button.row);
    expect(created).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});

test("ordinary sidebar has no New Thread button", async () => {
  const setup = await testRender(<ThreadTree rows={[]} cursor={0} />, { width: 30, height: 8 });

  try {
    await waitForText(setup, "no threads");
    expect(setup.captureCharFrame()).not.toContain("+");
  } finally {
    setup.renderer.destroy();
  }
});
