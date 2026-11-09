import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.each([true, false])(
  "release guard waits for queued changesets but ignores archived ones (%s)",
  async (pending) => {
    const workflow = await Bun.file(".github/workflows/release.yml").text();
    const guard = workflow.split("  guard:\n")[1]?.split("\n  build:")[0];
    const body = guard?.split("      - id: check\n")[1]?.split("        run: |\n")[1];

    if (!body) throw new Error("Release guard executable step was not found");

    const script = body
      .split("\n")
      .map((line) => line.replace(/^          /, ""))
      .join("\n");
    const directory = mkdtempSync(join(tmpdir(), "cueloop-release-guard-"));
    const output = join(directory, "outputs");
    const bin = join(directory, "bin");

    mkdirSync(bin);
    mkdirSync(join(directory, "packages", "cli"), { recursive: true });
    mkdirSync(join(directory, "packages", "sync"), { recursive: true });
    mkdirSync(join(directory, ".changeset", "pre"), { recursive: true });
    writeFileSync(
      join(directory, "packages", "cli", "package.json"),
      JSON.stringify({ name: "cueloop", version: "1.0.0" }),
    );
    writeFileSync(
      join(directory, "packages", "sync", "package.json"),
      JSON.stringify({ name: "@cueloop/sync", version: "1.0.0" }),
    );
    writeFileSync(join(directory, ".changeset", "pre", "archived.md"), "Archived changeset");

    if (pending) writeFileSync(join(directory, ".changeset", "feature.md"), "Pending changeset");

    writeFileSync(
      join(bin, "npm"),
      '#!/bin/sh\ncase "$2" in @cueloop/sync@*) echo E404 >&2; exit 1;; *) echo 1.0.0;; esac\n',
      { mode: 0o755 },
    );

    try {
      const child = Bun.spawn(["bash", "-eu", "-c", script], {
        cwd: directory,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await child.exited).toBe(0);
      const values = Object.fromEntries(
        readFileSync(output, "utf8")
          .trim()
          .split("\n")
          .map((line) => line.split("=")),
      );

      expect(values.publish).toBe(pending ? "false" : "true");
      expect(values.finalize).toBe(pending ? "false" : "true");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("release guard can see a draft release when resuming a partial publish", async () => {
  const workflow = await Bun.file(".github/workflows/release.yml").text();
  const guard = workflow.split("  guard:\n", 2)[1]?.split("\n  build:", 1)[0];

  expect(guard).toBeDefined();
  expect(guard).toContain("    permissions:\n      contents: write");
});
