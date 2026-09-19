/** The thread footer keeps its repo/branch context on one line: a long branch truncates to an
 * ellipsis rather than wrapping and pushing the send control onto a second row. */

import { test, expect } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ThreadFooter } from "./ThreadFooter";
import { settle } from "../test-support";
import { DARK } from "../theme";

test("a long branch truncates on one line and keeps the send control in place", async () => {
  const setup = await testRender(
    <box style={{ width: 60, height: 3, backgroundColor: DARK.background }}>
      <box style={{ flexGrow: 1 }} />
      <ThreadFooter
        repo="cueloop"
        branch="design/tui-tree-and-edgy-really-long-name"
        onSubmit={() => {}}
        theme={DARK}
      />
    </box>,
    { width: 60, height: 3 },
  );
  await settle(setup);
  await settle(setup);

  const frame = setup.captureCharFrame();
  const footerRow = frame.split("\n").find((line) => line.includes("cueloop"))!;
  // the repo/branch context and the send control share the single footer row
  expect(footerRow).toContain("send message");
  // the branch is clipped to an ellipsis, not wrapped onto a second row
  expect(footerRow).toContain("…");
  expect(frame).not.toContain("long-name");

  setup.renderer.destroy();
});
