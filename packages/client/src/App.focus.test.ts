import { describe, expect, test } from "bun:test";
import { nextFocusPane, reconciledFocus, threadsNavHandled, visiblePanes } from "./App";

describe("threads keyboard nav", () => {
  const base = () => {
    let cursor = 1;
    let opened = 0;

    return {
      setInboxCursor: (update: (cursor: number) => number) => (cursor = update(cursor)),
      openSession: () => (opened += 1),
      read: () => ({
        get cursor() {
          return cursor;
        },
        get opened() {
          return opened;
        },
      }),
    };
  };

  test("moves the cursor and opens only when the Threads pane is quiet and focused", () => {
    const spy = base();
    const call = (name: string) =>
      threadsNavHandled({
        focusedPane: "threads",
        quiet: true,
        key: { name },
        count: 3,
        setInboxCursor: spy.setInboxCursor,
        openSession: spy.openSession,
      });

    expect(call("down")).toBe(true);
    expect(spy.read().cursor).toBe(2);
    expect(call("down")).toBe(true); // clamps at the last row
    expect(spy.read().cursor).toBe(2);
    expect(call("k")).toBe(true);
    expect(spy.read().cursor).toBe(1);
    expect(call("return")).toBe(true);
    expect(spy.read().opened).toBe(1);
  });

  test("defers when another pane is focused, keys are owned elsewhere, or the inbox is empty", () => {
    const spy = base();
    const params = {
      quiet: true,
      key: { name: "down" },
      count: 3,
      setInboxCursor: spy.setInboxCursor,
      openSession: spy.openSession,
    };

    expect(threadsNavHandled({ ...params, focusedPane: "changes" })).toBe(false);
    expect(threadsNavHandled({ ...params, focusedPane: "threads", quiet: false })).toBe(false);
    expect(threadsNavHandled({ ...params, focusedPane: "threads", count: 0 })).toBe(false);
    expect(spy.read().cursor).toBe(1);
  });
});

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

  test("reconciledFocus falls back only when the focused pane is not navigable", () => {
    expect(reconciledFocus(["threads", "changes"], "threads")).toBeNull();
    expect(reconciledFocus(["threads", "changes"], "thread")).toBe("threads");
    expect(reconciledFocus(["changes", "project"], "thread")).toBe("changes");
    expect(reconciledFocus([], "thread")).toBeNull();
  });
});
