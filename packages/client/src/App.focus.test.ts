import { describe, expect, test } from "bun:test";
import { nextFocusPane, visiblePanes } from "./App";

describe("pane focus cycle", () => {
  test("visiblePanes lists only the open panes, in reading order", () => {
    expect(visiblePanes(true, true, true, true)).toEqual([
      "threads",
      "thread",
      "changes",
      "project",
    ]);
    expect(visiblePanes(true, false, true, true)).toEqual(["threads", "changes", "project"]);
    expect(visiblePanes(false, false, true, false)).toEqual(["changes"]);
  });

  test("nextFocusPane wraps forward and back over the visible panes", () => {
    const panes = visiblePanes(true, false, true, true);

    expect(nextFocusPane("threads", panes, false)).toBe("changes");
    expect(nextFocusPane("project", panes, false)).toBe("threads");
    expect(nextFocusPane("threads", panes, true)).toBe("project");
    expect(nextFocusPane("changes", [], false)).toBe("changes");
  });
});
