import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createTestGitRepo } from "../helpers/git-repo";

test.each(["release", "empty", "archived", "invalid", "draft", "published"] as const)(
  "release guard checks the Changesets release plan for %s input",
  async (scenario) => {
    const workflow = await Bun.file(".github/workflows/release.yml").text();
    const guard = workflow.split("  guard:\n")[1]?.split("\n  build:")[0];
    const body = guard?.split("      - id: check\n")[1]?.split("        run: |\n")[1];

    if (!body) throw new Error("Release guard executable step was not found");

    const script = body
      .split("\n")
      .map((line) => line.replace(/^          /, ""))
      .join("\n");
    const repository = createTestGitRepo([]);
    const directory = repository.dir;
    const output = join(directory, "outputs");
    const bin = join(directory, "bin");

    try {
      mkdirSync(bin);
      mkdirSync(join(directory, "packages", "cli"), { recursive: true });
      mkdirSync(join(directory, "packages", "sync"), { recursive: true });
      mkdirSync(join(directory, ".changeset", "pre"), { recursive: true });
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({
          name: "release-guard-fixture",
          private: true,
          workspaces: ["packages/*"],
        }),
      );
      writeFileSync(join(directory, "bun.lock"), "");
      writeFileSync(
        join(directory, ".changeset", "config.json"),
        JSON.stringify({ changelog: false, access: "public", baseBranch: "main" }),
      );
      writeFileSync(
        join(bin, "bunx"),
        '#!/bin/sh\n[ "$1" = changeset ] || exit 1\nshift\nexec "$CHANGESET_RUNTIME" "$CHANGESET_CLI" "$@"\n',
        { mode: 0o755 },
      );
      writeFileSync(
        join(directory, "packages", "cli", "package.json"),
        JSON.stringify({ name: "cueloop", version: "1.0.0" }),
      );
      writeFileSync(
        join(directory, "packages", "sync", "package.json"),
        JSON.stringify({ name: "@cueloop/sync", version: "1.0.0" }),
      );
      writeFileSync(
        join(directory, ".changeset", "pre", "archived.md"),
        "---\ncueloop: patch\n---\nArchived release.\n",
      );
      writeFileSync(
        join(directory, ".changeset", "pre.json"),
        JSON.stringify({ mode: "pre", tag: "alpha" }),
      );

      if (scenario !== "archived") {
        const content =
          scenario === "release"
            ? "---\ncueloop: patch\n---\n\nFixture release.\n"
            : scenario === "invalid"
              ? "---\n[invalid yaml\n---\n"
              : "---\n{}\n---\n";

        writeFileSync(join(directory, ".changeset", "feature.md"), content);
      }

      writeFileSync(
        join(bin, "npm"),
        '#!/bin/sh\nif [ "$ALL_PACKAGES_PUBLISHED" != true ] && [ "$2" = @cueloop/sync@1.0.0 ]; then echo E404 >&2; exit 1; fi\necho 1.0.0\n',
        { mode: 0o755 },
      );

      writeFileSync(
        join(bin, "gh"),
        '#!/bin/sh\n[ "$1" = release ] && [ "$2" = view ] || exit 1\necho "$RELEASE_IS_DRAFT"\n',
        { mode: 0o755 },
      );
      const allPackagesPublished = scenario === "draft" || scenario === "published";

      const child = Bun.spawn(["bash", "-eu", "-c", script], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GITHUB_OUTPUT: output,
          ALL_PACKAGES_PUBLISHED: String(allPackagesPublished),
          RELEASE_IS_DRAFT: String(scenario !== "published"),
          CHANGESET_RUNTIME: process.execPath,
          CHANGESET_CLI: resolve("node_modules/@changesets/cli/bin.js"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [status, messages, errors] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      if (scenario === "invalid") {
        expect(status, messages + errors).not.toBe(0);
        expect(await Bun.file(output).exists()).toBe(true);
        expect(readFileSync(output, "utf8")).not.toContain("publish=");

        return;
      }

      expect(status, messages + errors).toBe(0);
      const values = Object.fromEntries(
        readFileSync(output, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split("=")),
      );

      expect(values.publish).toBe(
        scenario === "release" || allPackagesPublished ? "false" : "true",
      );
      expect(values.any_published).toBe(scenario === "release" ? "false" : "true");
      expect(values.finalize).toBe(
        scenario === "release" || scenario === "published" ? "false" : "true",
      );
      expect(values.release_published).toBe(scenario === "published" ? "true" : "false");
    } finally {
      repository.cleanup();
    }
  },
);

test("release guard can see a draft release when resuming a partial publish", async () => {
  const workflow = await Bun.file(".github/workflows/release.yml").text();
  const guard = workflow.split("  guard:\n", 2)[1]?.split("\n  build:", 1)[0];

  expect(guard).toBeDefined();
  expect(guard).toContain("    permissions:\n      contents: write");
});
