import { expect, test } from "bun:test";

test("release guard can see a draft release when resuming a partial publish", async () => {
  const workflow = await Bun.file(".github/workflows/release.yml").text();
  const guard = workflow.split("  guard:\n", 2)[1]?.split("\n  build:", 1)[0];

  expect(guard).toBeDefined();
  expect(guard).toContain("    permissions:\n      contents: write");
});
