import { expect } from "bun:test";
import { createTestGitRepo } from "../helpers/git-repo";
import { createTestReviewHome } from "../helpers/review-home";
import { launchTuiSession } from "../helpers/pty-tui-session";
import { ptyTest } from "../helpers/pty-reviews";

ptyTest("typing a comment in a project file preserves visible selection position", async () => {
  const content = Array.from(
    { length: 160 },
    (_, index) => `project line ${String(index).padStart(3, "0")} content`,
  ).join("\n");
  const repo = createTestGitRepo([{ path: "LICENSE", before: content, after: content }]);
  const reviewHome = createTestReviewHome();
  const session = launchTuiSession({
    home: reviewHome.home,
    args: [],
    cwd: repo.dir,
    cols: 120,
    rows: 28,
  });

  try {
    await session.waitForReady();
    await session.click("project");
    await session.click("LICENSE");
    await session.waitForText("project line 000");
    await session.click("project line 000");
    for (let step = 0; step < 80; step++) {
      await session.press("down");
    }
    const firstVisible = session.text().match(/project line (\d{3})/);

    if (!firstVisible) throw new Error("project file rows missing");

    const first = Number(firstVisible[1]);

    expect(first).toBeGreaterThan(0);
    const startText = `project line ${String(first + 3).padStart(3, "0")}`;
    const endText = `project line ${String(first + 7).padStart(3, "0")}`;
    const start = session.locate(startText);
    const end = session.locate(endText);

    await session.dragAt(start.column, start.row, end.column + endText.length, end.row);
    const before = session.locate(startText).row;

    session.captureTerminalFrames = true;
    await session.type("h");
    await session.waitForText("● h");
    session.captureTerminalFrames = false;
    expect(session.terminalFrames.length).toBeGreaterThan(0);
    for (const frame of session.terminalFrames) {
      expect(frame.split("\n").findIndex((line) => line.includes(startText))).toBe(before);
    }
    expect(session.locate(startText).row).toBe(before);
    await session.type("ello world");
    await session.waitForText("hello world");
    expect(session.locate(startText).row).toBe(before);
  } finally {
    await session.close();
    reviewHome.cleanup();
    repo.cleanup();
  }
});
