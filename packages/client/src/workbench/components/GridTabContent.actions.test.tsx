/** File tabs keep path actions while only the aggregate Changes tab can fold a file. */

import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { changesTab, fileTab } from "./editor-grid";
import { GridTabContent, type DiffSurfaceProps } from "./GridTabContent";
import { FIXTURE_PATCH, fixtureDiffSession } from "../../stories/story-fixtures";
import { NERD } from "../../ui/components/primitives/icons";
import { TooltipProvider } from "../../ui/components/Tooltip";
import { locateText, waitForText } from "../../testing/test-support";
import { DARK } from "../../appearance/theme";
import { diffRows } from "../../diff/view-diff";

const noop = (): void => {};
const rows = diffRows(
  FIXTURE_PATCH.replaceAll("src/store.ts", "src/store.txt").replace("-1,4 +1,4", "-1,3 +1,3"),
);
const surface: DiffSurfaceProps = {
  session: fixtureDiffSession(),
  quickActions: [],
  observer: false,
  onAnnotate: noop,
  onReply: noop,
  onUpdateAnnotation: noop,
  onExit: noop,
};

test("a single-file diff keeps copy and expand without a collapse action", async () => {
  const copied: string[] = [];
  const setup = await testRender(
    <TooltipProvider theme={DARK}>
      <GridTabContent
        tab={fileTab("store.txt", "src/store.txt", "diff")}
        rows={rows}
        surface={surface}
        rejectedRows={new Set()}
        fold={{
          isCollapsed: () => false,
          isExpanded: () => false,
          canExpand: () => true,
          onToggleCollapse: noop,
          onToggleExpand: noop,
          onCopyPath: (file) => {
            copied.push(file);

            return true;
          },
        }}
        dimmed={false}
        readFile={async () => null}
        onAddFileComment={noop}
        theme={DARK}
      />
    </TooltipProvider>,
    { width: 80, height: 12 },
  );

  await waitForText(setup, "src/store.txt");
  const frame = setup.captureCharFrame();

  expect(frame).toContain(NERD.copy);
  expect(frame).not.toContain("v src/store.txt");
  expect(frame).toContain("expand");
  const copy = locateText(setup, NERD.copy);

  await setup.mockMouse.moveTo(copy.column, copy.row);
  await waitForText(setup, "Copy path");
  await setup.mockMouse.click(copy.column, copy.row);
  expect(copied).toEqual(["src/store.txt"]);
  await waitForText(setup, "copied");
  await setup.waitForVisualIdle();
  setup.renderer.destroy();
});

test("the full Changes tab retains fold and expand controls", async () => {
  const setup = await testRender(
    <GridTabContent
      tab={changesTab()}
      rows={rows}
      surface={surface}
      rejectedRows={new Set()}
      fold={{
        isCollapsed: () => false,
        isExpanded: () => false,
        canExpand: () => true,
        onToggleCollapse: noop,
        onToggleExpand: noop,
        onCopyPath: () => true,
      }}
      dimmed={false}
      readFile={async () => null}
      onAddFileComment={noop}
      theme={DARK}
    />,
    { width: 80, height: 12 },
  );

  await waitForText(setup, "src/store.txt");
  const frame = setup.captureCharFrame();

  expect(frame).toContain("src/store.txt");
  expect(frame).not.toContain("v src/store.txt");
  expect(frame).toContain(NERD.copy);
  expect(frame).toContain("expand");
  await setup.waitForVisualIdle();
  setup.renderer.destroy();
});

test("the file title tooltip follows its collapse action", async () => {
  function TestChanges(): React.ReactNode {
    const [collapsed, setCollapsed] = React.useState(false);

    return (
      <TooltipProvider theme={DARK}>
        <GridTabContent
          tab={changesTab()}
          rows={rows}
          surface={surface}
          rejectedRows={new Set()}
          fold={{
            isCollapsed: () => collapsed,
            isExpanded: () => false,
            canExpand: () => true,
            onToggleCollapse: () => setCollapsed((current) => !current),
            onToggleExpand: noop,
            onCopyPath: () => true,
          }}
          dimmed={false}
          readFile={async () => null}
          onAddFileComment={noop}
          theme={DARK}
        />
      </TooltipProvider>
    );
  }

  const setup = await testRender(<TestChanges />, { width: 80, height: 12 });

  await waitForText(setup, "src/store.txt");
  const title = locateText(setup, "src/store.txt");

  await setup.mockMouse.moveTo(title.column, title.row);
  await waitForText(setup, "collapse");
  await setup.mockMouse.click(title.column, title.row);
  await waitForText(setup, "uncollapse");
  await setup.mockMouse.click(title.column, title.row);
  await waitForText(setup, "collapse");
  expect(setup.captureCharFrame()).not.toContain("uncollapse");
  setup.renderer.destroy();
});
