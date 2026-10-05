import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { CommentRow } from "./AnnotationCards";
import { DARK } from "../../appearance/theme";
import { TooltipProvider } from "../../ui/components/Tooltip";
import { locateText, settle } from "../../testing/test-support";

test("submitted comment checks stay visible on hover and navigate to the reply", async () => {
  let navigations = 0;
  const setup = await testRender(
    <TooltipProvider>
      <CommentRow
        annotation={{
          id: "submitted",
          kind: "comment",
          body: "Explain the change",
          anchor: { quote: "change", prefix: "", suffix: "", blockIndex: 0, start: 0, end: 6 },
          createdAt: "2026-10-04",
        }}
        tokens={DARK}
        action={{ label: "View reply", run: () => navigations++ }}
      />
    </TooltipProvider>,
    { width: 60, height: 8 },
  );

  try {
    await settle(setup);
    const checks = locateText(setup, "✓✓");

    await setup.mockMouse.moveTo(checks.column, checks.row);
    await settle(setup);
    expect(setup.captureCharFrame()).toContain("✓✓");
    expect(setup.captureCharFrame()).toContain("View reply");
    expect(setup.captureCharFrame()).not.toContain("↓");
    await setup.mockMouse.click(checks.column, checks.row);
    expect(navigations).toBe(1);
  } finally {
    setup.renderer.destroy();
  }
});
