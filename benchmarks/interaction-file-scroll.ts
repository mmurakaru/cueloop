/** Profile caret movement through a scrollable project file in the Changes editor. */

import { createElement, useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import type { Annotation } from "@cueloop/schema";
import { GridTabContent } from "../packages/client/src/components/GridTabContent";
import { fixtureDiffSession } from "../packages/client/src/components/story-fixtures";
import { diffRows } from "../packages/client/src/view-diff";
import { DARK } from "../packages/client/src/theme";
import { press, waitForText } from "../packages/client/src/test-support";
import { emitLatencyMetrics, emitMetric } from "./lib/metric";

const LINES = 1500;
const PRESSES = 120;
const content = Array.from(
  { length: LINES },
  (_, index) =>
    `+export const line${index} = "${"a long value that wraps inside the file editor ".repeat(3)}";`,
).join("\n");
const rows = diffRows(
  `diff --git a/src/large.ts b/src/large.ts\n--- a/src/large.ts\n+++ b/src/large.ts\n@@ -0,0 +1,${LINES} @@\n${content}\n`,
);
const noop = (): void => {};
const annotations: Annotation[] = [8, 16, 24, 40, 56, 72, 88, 104].map((rowIndex) => ({
  id: `a${rowIndex}`,
  kind: "comment",
  body: "this deliberately long discussion body wraps across the narrow viewport and makes an inline card several visual rows tall",
  anchor: { quote: rows[rowIndex]!.text.replace(/\n$/, ""), prefix: "", suffix: "" },
  createdAt: "2026-01-01T00:00:00Z",
}));
const session = fixtureDiffSession({ annotations });
const tab = {
  id: "large",
  kind: "file" as const,
  label: "large.ts",
  path: "src/large.ts",
  fileView: "diff" as const,
};
const rejectedRows = new Set<number>();

function FileUnderAppState() {
  const [, setCursor] = useState(0);

  return createElement(GridTabContent, {
    tab,
    rows,
    surface: {
      session,
      quickActions: [],
      observer: false,
      commentsEnabled: true,
      onCursorChange: setCursor,
      onAnnotate: noop,
      onReply: noop,
      onUpdateAnnotation: noop,
      onExit: noop,
    },
    rejectedRows,
    dimmed: false,
    readFile: async () => null,
    onAddFileComment: noop,
    theme: DARK,
  });
}

function findScrollbox(node: Renderable): ScrollBoxRenderable | null {
  if (node.id === "diff-scroll" && node instanceof ScrollBoxRenderable) return node;

  for (const child of node.getChildren()) {
    const found = findScrollbox(child);

    if (found) return found;
  }

  return null;
}

const setup = await testRender(createElement(FileUnderAppState), { width: 60, height: 12 });

await waitForText(setup, "line0");
const scrollbox = findScrollbox(setup.renderer.root);

if (!scrollbox) throw new Error("file scrollbox missing");
const pressMs: number[] = [];
const scrollSteps: number[] = [];

for (let index = 0; index < PRESSES; index++) {
  const started = performance.now();
  const before = scrollbox.scrollTop;

  // eslint-disable-next-line no-await-in-loop
  await press(setup, "down");
  pressMs.push(performance.now() - started);
  scrollSteps.push(scrollbox.scrollTop - before);
}

emitMetric("file_lines", LINES);
emitMetric("inline_comments", annotations.length);
emitMetric("presses", PRESSES);
emitMetric("scroll_max_step", Math.max(...scrollSteps));
emitMetric("scroll_rewinds", scrollSteps.filter((step) => step < 0).length);
emitLatencyMetrics("file_scroll_press", pressMs);
setup.renderer.destroy();
process.exit(0);
