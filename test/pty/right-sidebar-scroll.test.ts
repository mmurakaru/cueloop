/** Both right sidebar file trees keep keyboard selection visible in completed terminal frames. */

import { expect } from "bun:test";
import { createTestGitRepo } from "../helpers/git-repo";
import { createTestReviewHome } from "../helpers/review-home";
import { launchTuiSession } from "../helpers/pty-tui-session";
import { ptyTest } from "../helpers/pty-reviews";

ptyTest("right sidebar changes and project trees reveal keyboard selection", async () => {
  const files = [
    { path: "aaa-project-only.ts", before: "same\n", after: "same\n" },
    ...Array.from({ length: 35 }, (_, index) => ({
      path: `file-${String(index).padStart(2, "0")}.ts`,
      before: "old\n",
      after: "new\n",
    })),
  ];
  const repo = createTestGitRepo(files);
  const reviewHome = createTestReviewHome();
  const diff = await repo.diff();
  const review = reviewHome.server.core.sessionCreate({
    workspace: { repoRoot: repo.dir, branch: "main" },
    artifact: {
      type: "diff",
      content: diff.patch,
      files: diff.files,
      meta: { title: "sidebar scroll" },
    },
  });
  const session = launchTuiSession({
    home: reviewHome.home,
    args: [review.id],
    cols: 110,
    rows: 18,
  });

  try {
    await session.waitForReady();
    await session.waitForScreen((screen) => screen.split("\n")[2]?.includes("file-00.ts") ?? false);
    expect(session.text()).not.toContain("aaa-project-only.ts");
    // Target the tab itself; empty header cells do not establish tree focus.
    await session.click("changes");
    for (const key of Array.from({ length: 16 }, () => "j" as const)) {
      // eslint-disable-next-line no-await-in-loop
      await session.press(key);
    }
    expect(session.text()).toContain("file-16.ts");

    const selectedLocation = session.locate("file-16.ts");
    const selectedForeground = JSON.stringify(
      session.cells(selectedLocation.row)[selectedLocation.column]?.fg,
    );
    const selectedFiles: string[][] = [];

    expect(selectedForeground).toBeDefined();
    session.terminalFrames.length = 0;
    session.onTerminalFrame = (frame, cellAt) => {
      const selected: string[] = [];

      for (let row = 0; row < frame.split("\n").length; row++) {
        const cell = cellAt(selectedLocation.column, row);

        if (
          cell === null ||
          cell.codepoint !== "f".codePointAt(0) ||
          JSON.stringify(cell.fg) !== selectedForeground
        )
          continue;

        selected.push(
          Array.from({ length: "file-17.ts".length }, (_, offset) =>
            String.fromCodePoint(cellAt(selectedLocation.column + offset, row)?.codepoint ?? 0),
          ).join(""),
        );
      }
      selectedFiles.push(selected);
    };
    session.onTerminalFrame(session.text(), (column, row) => session.cells(row)[column] ?? null);
    session.captureTerminalFrames = true;
    await session.press("j");
    session.captureTerminalFrames = false;
    session.onTerminalFrame = undefined;
    expect(selectedFiles.length).toBeGreaterThan(0);
    for (const selected of selectedFiles) expect(selected).toHaveLength(1);
    const selections = selectedFiles.map((selected) => selected.join(""));
    const revealed = selections.indexOf("file-17.ts");

    expect(selections[0]).toBe("file-16.ts");
    expect(revealed).toBeGreaterThanOrEqual(0);
    for (const selected of selections) expect(["file-16.ts", "file-17.ts"]).toContain(selected);
    for (const selected of selections.slice(revealed)) expect(selected).toBe("file-17.ts");

    await session.click("project");
    await session.waitForText("aaa-project-only.ts");
    for (const key of Array.from({ length: 18 }, () => "j" as const)) {
      // eslint-disable-next-line no-await-in-loop
      await session.press(key);
    }
    expect(session.text()).toContain("file-17.ts");
  } finally {
    await session.close();
    reviewHome.cleanup();
    repo.cleanup();
  }
});
