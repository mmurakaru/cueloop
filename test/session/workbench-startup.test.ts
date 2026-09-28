import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { createTestGitRepo } from "../helpers/git-repo";
import { createTestReviewHome } from "../helpers/review-home";

test("opening a workbench returns the diff used to create it and refreshes an existing one", async () => {
  const repo = createTestGitRepo([
    {
      path: "src/store.ts",
      before: "export const value = 1;\n",
      after: "export const value = 2;\n",
    },
  ]);
  const reviewHome = createTestReviewHome();
  const server = new DaemonServer({ home: reviewHome.home, idleExitMs: 0 });

  server.start();
  const client = await DaemonClient.connect({ home: reviewHome.home });

  try {
    const first = await client.workbenchReview(repo.dir);

    expect(first.session.artifact.content).toBe(first.diff.patch);
    expect(first.diff.patch).toContain("+export const value = 2;");
    expect(first.diff.files[0]?.newContents).toBe("export const value = 2;\n");

    writeFileSync(join(repo.dir, "src/store.ts"), "export const value = 3;\n");
    const reopened = await client.workbenchReview(repo.dir);

    expect(reopened.session.id).toBe(first.session.id);
    expect(reopened.diff.patch).toContain("+export const value = 3;");
    expect(reopened.diff.files[0]?.newContents).toBe("export const value = 3;\n");
  } finally {
    client.close();
    server.stop();
    reviewHome.cleanup();
    repo.cleanup();
  }
});
