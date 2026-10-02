/** A real terminal must paint each keyboard scroll step across an inline discussion. */

import { expect } from "bun:test";
import { diffRows } from "../../packages/client/src/diff/view-diff";
import { createTestReviewHome } from "../helpers/review-home";
import { launchTuiSession } from "../helpers/pty-tui-session";
import { ptyTest } from "../helpers/pty-reviews";

ptyTest(
  "diff navigation scrolls at most one screen row per arrow key across a comment",
  async () => {
    const reviewHome = createTestReviewHome();
    const added = Array.from(
      { length: 45 },
      (_, index) =>
        `+line ${String(index).padStart(2, "0")} a long paragraph that wraps through the narrow editor`,
    );
    const patch = [
      "diff --git a/scroll.txt b/scroll.txt",
      "--- a/scroll.txt",
      "+++ b/scroll.txt",
      "@@ -0,0 +1,45 @@",
      ...added,
      "",
    ].join("\n");
    const review = reviewHome.createDiffSession(patch);
    const row = diffRows(patch).find((candidate) => candidate.text.includes("line 08"));

    if (!row) throw new Error("annotation row missing");
    reviewHome.server.core.sessionAnnotate(review.id, {
      id: "scroll-note",
      kind: "comment",
      anchor: { quote: row.text.replace(/\n$/, ""), prefix: "", suffix: "" },
      body: "This discussion is long enough to wrap onto several rows in the narrow terminal viewport.",
    });

    const session = launchTuiSession({
      home: reviewHome.home,
      args: [review.id],
      cols: 90,
      rows: 18,
    });

    try {
      await session.waitForReady();
      await session.waitForText("line 00", { what: "the diff's first code row" });

      const visibleRows = (screen: string): Map<number, number> => {
        const positions = new Map<number, number>();

        screen.split("\n").forEach((line, screenRow) => {
          const match = line.match(/line (\d{2})/);

          if (match) positions.set(Number(match[1]), screenRow);
        });

        return positions;
      };

      let before = visibleRows(session.text());
      let crossedComment = false;

      for (let step = 0; step < 55; step++) {
        if (step === 15) session.captureTerminalFrames = true;
        await session.press("down");
        if (step === 15) {
          session.captureTerminalFrames = false;
          expect(session.terminalFrames).toHaveLength(1);
          expect(session.terminalFrames[0]?.match(/▎/g)).toHaveLength(1);
          expect(session.terminalFrames[0]).toContain("▎        paragraph that");
        }
        await session.waitIdle();
        const after = visibleRows(session.text());
        const shared = [...before].filter(([line]) => after.has(line));

        expect(shared.length).toBeGreaterThan(0);
        for (const [line, screenRow] of shared) {
          expect(Math.abs(after.get(line)! - screenRow)).toBeLessThanOrEqual(1);
        }
        crossedComment ||= session.text().includes("This discussion");
        before = after;
      }

      expect(crossedComment).toBe(true);
      for (let step = 0; step < 55; step++) {
        await session.press("up");
        await session.waitIdle();
        const after = visibleRows(session.text());
        const shared = [...before].filter(([line]) => after.has(line));

        expect(shared.length).toBeGreaterThan(0);
        for (const [line, screenRow] of shared) {
          expect(Math.abs(after.get(line)! - screenRow)).toBeLessThanOrEqual(1);
        }
        expect(session.text()).toContain("▎");
        before = after;
      }
    } finally {
      await session.close();
      reviewHome.cleanup();
    }
  },
);

ptyTest("wheel scrolling keeps a bottom-edge caret visible in completed frames", async () => {
  const reviewHome = createTestReviewHome();
  const added = Array.from({ length: 80 }, (_, row) => `+line ${String(row).padStart(2, "0")}`);
  const patch = [
    "diff --git a/scroll.txt b/scroll.txt",
    "--- a/scroll.txt",
    "+++ b/scroll.txt",
    "@@ -0,0 +1,80 @@",
    ...added,
    "",
  ].join("\n");
  const review = reviewHome.createDiffSession(patch);
  const session = launchTuiSession({
    home: reviewHome.home,
    args: [review.id],
    cols: 90,
    rows: 18,
  });

  try {
    await session.waitForReady();
    await session.waitForText("line 00");
    for (const key of Array.from({ length: 30 }, () => "down" as const)) {
      // eslint-disable-next-line no-await-in-loop
      await session.press(key);
    }
    const markerRow = session
      .text()
      .split("\n")
      .findIndex((line) => line.includes("▎"));

    expect(markerRow).toBeGreaterThan(0);
    session.captureTerminalFrames = true;
    await session.wheelAt(39, 9, "up");
    session.captureTerminalFrames = false;
    const frames = session.terminalFrames;

    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      const markers = frame.split("\n").flatMap((line, row) => (line.includes("▎") ? [row] : []));

      expect(markers).toEqual([markerRow]);
    }
  } finally {
    await session.close();
    reviewHome.cleanup();
  }
});
