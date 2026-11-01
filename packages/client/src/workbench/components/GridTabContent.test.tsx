import { expect, test } from "bun:test";
import React, { useEffect, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { GridTabContent } from "./GridTabContent";
import { diffRows, type DiffRow } from "../../diff/view-diff";
import { fixtureDiffSession } from "../../stories/story-fixtures";
import { DARK } from "../../appearance/theme";
import { press, waitForText } from "../../testing/test-support";

function createTestFilePatch(secondName: string): string {
  return [
    "diff --git a/first.ts b/first.ts",
    "--- /dev/null",
    "+++ b/first.ts",
    "@@ -0,0 +1,3 @@",
    "+export const firstOld = 1;",
    "+export const firstNext = 2;",
    "+export const firstLast = 3;",
    "diff --git a/second.ts b/second.ts",
    "--- /dev/null",
    "+++ b/second.ts",
    "@@ -0,0 +1,1 @@",
    `+export const ${secondName} = 4;`,
    "",
  ].join("\n");
}

test("a file tab follows file switches and fresh rows after cursor updates", async () => {
  const initialRows = diffRows(createTestFilePatch("secondOld"));
  const session = fixtureDiffSession();
  const noop = () => {};
  let changePath: (path: string) => void = noop;
  let changeRows: (rows: DiffRow[]) => void = noop;
  let changeView: (view: "diff" | "contents") => void = noop;

  function FileReview() {
    const [path, setPath] = useState("first.ts");
    const [rows, setRows] = useState(initialRows);
    const [fileView, setFileView] = useState<"diff" | "contents">("diff");
    const [, setCursor] = useState(0);

    useEffect(() => {
      changePath = setPath;
      changeRows = setRows;
      changeView = setFileView;
    }, []);

    return (
      <GridTabContent
        tab={{ id: "file", kind: "file", path, label: path, fileView }}
        rows={rows}
        surface={{
          session,
          quickActions: [],
          observer: false,
          onCursorChange: setCursor,
          onAnnotate: noop,
          onReply: noop,
          onUpdateAnnotation: noop,
          onExit: noop,
        }}
        rejectedRows={new Set()}
        dimmed={false}
        readFile={async () => "Full file contents\n"}
        onAddFileComment={noop}
        theme={DARK}
      />
    );
  }
  const setup = await testRender(<FileReview />, { width: 100, height: 20 });

  try {
    await waitForText(setup, "firstOld");
    await press(setup, "down");
    await press(setup, "down");
    expect(setup.captureCharFrame()).toContain("firstLast");
    changePath("second.ts");
    await waitForText(setup, "secondOld");
    expect(setup.captureCharFrame()).not.toContain("firstOld");
    changeRows(diffRows(createTestFilePatch("secondFresh")));
    await waitForText(setup, "secondFresh");
    expect(setup.captureCharFrame()).not.toContain("secondOld");
    changeView("contents");
    await waitForText(setup, "Full file contents");
    expect(setup.captureCharFrame()).not.toContain("secondFresh");
    changeView("diff");
    await waitForText(setup, "secondFresh");
    expect(setup.captureCharFrame()).not.toContain("Full file contents");
  } finally {
    setup.renderer.destroy();
  }
});
