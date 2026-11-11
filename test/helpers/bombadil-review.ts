import { createHash } from "node:crypto";
import { existsSync, watch, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Thread } from "@cueloop/schema";
import { createTestReviewHome } from "./review-home.ts";
import { createTestGitRepo, type TestGitRepo } from "./git-repo.ts";
import { hermeticCueloopEnvironment } from "./env.ts";

import {
  BOMBADIL_PLAN_READY_TITLE,
  BOMBADIL_DIFF_READY_TITLE,
  type BombadilScenario,
} from "../bombadil/fixture-contract.ts";

function reviewFingerprint(thread: Thread): string {
  const {
    artifact,
    annotations,
    revisions,
    history,
    status,
    message,
    workingCopy,
    textCuts,
    curation,
  } = thread;

  return createHash("sha256")
    .update(
      JSON.stringify({
        artifact,
        annotations,
        revisions,
        history,
        status,
        message,
        workingCopy,
        textCuts,
        curation,
      }),
    )
    .digest("hex");
}

export async function createTestBombadilReview(scenario: BombadilScenario) {
  const reviewHome = createTestReviewHome();
  let repository: TestGitRepo | undefined;

  try {
    const plan =
      "# Navigation fixture\n\n" +
      Array.from(
        { length: 80 },
        (_, index) => `Navigation sample ${index}: café 界 🙂 and stable review text.\n`,
      ).join("\n");
    let thread: Thread;

    if (scenario === "diff") {
      repository = createTestGitRepo(
        ["src/cache.ts", "src/view.ts"].map((path, fileIndex) => ({
          path,
          before: Array.from(
            { length: 45 },
            (_, index) => `export const record${index} = ${index + fileIndex};\n`,
          ).join(""),
          after: Array.from(
            { length: 45 },
            (_, index) => `export const record${index} = ${index + fileIndex + 1};\n`,
          ).join(""),
        })),
      );
      const diff = await repository.diff();

      thread = reviewHome.createDiffSession(diff.patch, diff.files, "Awaiting readiness");
    } else {
      thread = reviewHome.createPlanSession(plan, "Awaiting readiness");
    }

    const configuration = join(reviewHome.home, "empty.toml");
    const readyFile = join(reviewHome.home, "ready");
    const readiness = Promise.withResolvers<void>();
    const watcher = watch(reviewHome.home, () => {
      if (existsSync(readyFile)) readiness.resolve();
    });
    const timeout = setTimeout(
      () => readiness.reject(new Error("Bombadil review did not emit its ready-file signal")),
      15_000,
    );

    watcher.on("error", readiness.reject);
    writeFileSync(configuration, "");
    reviewHome.createShellScript("ssh", "exit 125");

    return {
      command: [process.execPath, "run", resolve("packages/cli/src/main.ts"), thread.id],
      environment: hermeticCueloopEnvironment(reviewHome.home, {
        CUELOOP_CONFIG: configuration,
        CUELOOP_READY_FILE: readyFile,
        PATH: `${reviewHome.home}:${process.env.PATH ?? ""}`,
      }),
      directory: reviewHome.home,
      async arm() {
        await readiness.promise;
        clearTimeout(timeout);
        watcher.close();
        reviewHome.server.core.sessionSetTitle(
          thread.id,
          scenario === "diff" ? BOMBADIL_DIFF_READY_TITLE : BOMBADIL_PLAN_READY_TITLE,
        );
        // The revision exposes the action gate only after the ready-file signal.
        reviewHome.server.core.sessionSubmitRevision(
          thread.id,
          scenario === "negative-control"
            ? `# \uFFFD Negative control\n\n${plan}`
            : thread.artifact.content,
        );

        return reviewFingerprint(reviewHome.server.core.sessionGet(thread.id));
      },
      fingerprint() {
        return reviewFingerprint(reviewHome.server.core.sessionGet(thread.id));
      },
      close() {
        clearTimeout(timeout);
        watcher.close();
        reviewHome.cleanup();
        repository?.cleanup();
      },
    };
  } catch (error) {
    reviewHome.cleanup();
    repository?.cleanup();

    throw error;
  }
}
