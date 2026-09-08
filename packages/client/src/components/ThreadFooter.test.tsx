/** The thread footer keeps its repo/branch context on one line: a long branch truncates to fit rather
 * than wrapping and pushing the send control onto a second row. */

import { test, expect } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ThreadFooter } from "./ThreadFooter";
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
  await setup.renderOnce();

  const lines = setup.captureCharFrame().split("\n");
  const footerRow = lines.find((line) => line.includes("cueloop"))!;
  // the repo/branch context and the send control share the single footer row
  expect(footerRow).toContain("send message");
  // the branch is clipped, not wrapped: it never reaches its tail on a second row
  expect(setup.captureCharFrame()).not.toContain("long-name");
});
