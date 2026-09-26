import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";
import { createTestReviewHome } from "../helpers/review-home";
import { launchDiffReview, ptyTest, STORE_CHANGE } from "../helpers/pty-reviews";

ptyTest("an installed workspace view opens from the keyboard in the real terminal", async () => {
  const reviewHome = createTestReviewHome();
  const installRoot = join(reviewHome.home, "extensions");
  const packageRoot = join(installRoot, "node_modules", "example-view");

  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify({ dependencies: { "example-view": "1.0.0" } }),
  );
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ cueloop: { client: "./client.js" } }),
  );
  writeFileSync(
    join(packageRoot, "client.js"),
    `export default (api) => api.registerView({
    id: "details", zone: "workspace.panels", title: "Details",
    Component: () => api.react.createElement("text", null, "Extension details"),
  });`,
  );
  const { session, repo } = await launchDiffReview(reviewHome, [STORE_CHANGE], {
    env: { CUELOOP_EXTENSION_HOME: installRoot },
  });

  try {
    await session.waitForText("Details");
    await session.click("project");
    const selected = await session.pressAndWaitForScreen(
      "]",
      (screen) => screen.includes("Extension details"),
      {
        what: "the installed workspace view",
      },
    );

    expect(selected).toContain("Extension details");
    await session.pressAndWaitForScreen("[", (screen) => !screen.includes("Extension details"), {
      what: "the built-in workspace view",
    });
  } finally {
    await session.close();
    repo.cleanup();
    reviewHome.cleanup();
  }
});
