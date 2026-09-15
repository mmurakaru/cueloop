import { describe, expect, test } from "bun:test";
import { appLeaderHandled, nextFocusPane, threadsNavHandled, visiblePanes } from "./App";

describe("threads keyboard nav", () => {
  const base = () => {
    let cursor = 1;
    let opened = 0;

    return {
      setInboxCursor: (update: (c: number) => number) => (cursor = update(cursor)),
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

  test("appLeaderHandled captures the leader for the sidebar panes, then the next key", () => {
    const leaderCombos = ["ctrl+g"];
    const pending = { current: false };
    const ran: string[] = [];
    const call = (
      focusedPane: "threads" | "project" | "thread" | "changes",
      key: { name: string; ctrl?: boolean },
    ) =>
      appLeaderHandled({
        focusedPane,
        key,
        leaderCombos,
        pending,
        runLeaderCommand: (pressed) => ran.push(pressed.name),
      });

    expect(call("threads", { name: "g", ctrl: true })).toBe(true);
    expect(pending.current).toBe(true);
    expect(call("threads", { name: "tab" })).toBe(true);
    expect(pending.current).toBe(false);
    expect(ran).toEqual(["tab"]);
  });

  test("appLeaderHandled defers on the content panes and swallows escape without a command", () => {
    const leaderCombos = ["ctrl+g"];
    let ran = false;
    const runLeaderCommand = () => (ran = true);

    expect(
      appLeaderHandled({
        focusedPane: "thread",
        key: { name: "ctrl+g" },
        leaderCombos,
        pending: { current: false },
        runLeaderCommand,
      }),
    ).toBe(false);

    const pending = { current: true };
    expect(
      appLeaderHandled({
        focusedPane: "project",
        key: { name: "escape" },
        leaderCombos,
        pending,
        runLeaderCommand,
      }),
    ).toBe(true);
    expect(pending.current).toBe(false);
    expect(ran).toBe(false);
  });
});
