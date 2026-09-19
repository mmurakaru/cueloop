import React from "react";
import { DARK } from "../theme";
import { DEFAULT_QUICK_ACTIONS } from "../config";
import type { Story, StoryMeta } from "./story";
import { GridTabContent, type DiffSurfaceProps } from "./GridTabContent";
import { fixtureDiffRows, fixtureDiffSession } from "./story-fixtures";
import { changesTab, fileTab } from "./editor-grid";

export const meta: StoryMeta = { title: "Surfaces/GridTabContent" };

const noop = (): void => {};

function surface(): DiffSurfaceProps {
  return {
    session: fixtureDiffSession({ annotations: [] }),
    quickActions: DEFAULT_QUICK_ACTIONS,
    observer: false,
    onAnnotate: noop,
    onReply: noop,
    onUpdateAnnotation: noop,
    onExit: noop,
  };
}

/** The whole-diff Changes tab: every changed file in one scroll container. */
export const ChangesTab: Story = {
  render: () => (
    <GridTabContent
      tab={changesTab()}
      rows={fixtureDiffRows()}
      surface={surface()}
      rejectedRows={new Set()}
      dimmed={false}
      readFile={async () => null}
      onAddFileComment={noop}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.text],
  size: { width: 80, height: 18 },
};

/** A single-file diff tab: that file's rows alone, indexed on their own. */
export const FileDiffTab: Story = {
  render: () => (
    <GridTabContent
      tab={fileTab("store.ts", "src/store.ts", "diff")}
      rows={fixtureDiffRows()}
      surface={surface()}
      rejectedRows={new Set()}
      dimmed={false}
      readFile={async () => null}
      onAddFileComment={noop}
      theme={DARK}
    />
  ),
  expectedColors: [DARK.text],
  size: { width: 80, height: 18 },
};
