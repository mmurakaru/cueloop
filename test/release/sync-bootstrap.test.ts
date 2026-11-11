import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const scenario of ["publish", "pending-changeset", "missing-token"] as const) {
  test(`first publication ${scenario} keeps packing separate from token-authenticated publishing`, async () => {
    const workflow = await Bun.file(".github/workflows/bootstrap-npm-package.yml").text();
    const step = workflow
      .split("      - name: Publish first version with repository token\n")[1]
      ?.split("      - name: Verify first publication\n")[0];
    const body = step?.split("        run: |\n")[1];

    if (!body)
      throw new Error("First-publish workflow must provide its executable publishing step");

    const script = body
      .split("\n")
      .map((line) => line.replace(/^          /, ""))
      .join("\n");
    const directory = await mkdtemp(join(tmpdir(), "cueloop-sync-bootstrap-"));
    const bin = join(directory, "bin");
    const record = join(directory, "npm-arguments.json");

    try {
      await mkdir(bin);
      await mkdir(join(directory, ".changeset", "pre"), { recursive: true });
      await writeFile(join(directory, ".changeset", "README.md"), "Changeset instructions");
      await writeFile(join(directory, ".changeset", "pre", "archived.md"), "Archived changeset");

      if (scenario === "pending-changeset")
        await writeFile(join(directory, ".changeset", "pending.md"), "Unversioned work");

      await writeFile(
        join(bin, "npm"),
        `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs'; writeFileSync(process.env.PUBLISH_RECORD, JSON.stringify(process.argv.slice(2)));\n`,
        { mode: 0o755 },
      );
      await writeFile(join(bin, "package.json"), '{"type":"module"}');
      const child = Bun.spawn(["bash", "-eu", "-c", script], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          NODE_AUTH_TOKEN: scenario === "missing-token" ? "" : "fixture-publish-credential",
          DIST_TAG: "alpha",
          TARBALL: "sync-package.tgz",
          PUBLISH_RECORD: record,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, output, errors] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(status).toBe(scenario === "publish" ? 0 : 1);
      expect(output + errors).not.toContain("fixture-publish-credential");

      if (scenario === "publish")
        expect(JSON.parse(await readFile(record, "utf8"))).toEqual([
          "publish",
          "./bootstrap/sync-package.tgz",
          "--access",
          "public",
          "--tag",
          "alpha",
          "--ignore-scripts",
        ]);
      else
        expect(
          await access(record).then(
            () => true,
            () => false,
          ),
        ).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const scenario of ["delayed-visibility", "wrong-integrity", "unavailable"] as const) {
  test(`first publication verification rejects replacement and handles ${scenario}`, async () => {
    const workflow = await Bun.file(".github/workflows/bootstrap-npm-package.yml").text();
    const body = workflow
      .split("      - name: Verify first publication\n")[1]
      ?.split("      - name: Show maintainer commands\n")[0]
      ?.split("        run: |\n")[1];

    if (!body) throw new Error("First-publish workflow must verify the prepared archive");

    const script = body
      .split("\n")
      .map((line) => line.replace(/^          /, ""))
      .join("\n");
    const directory = await mkdtemp(join(tmpdir(), "cueloop-sync-publication-integrity-"));
    const bin = join(directory, "bin");
    const record = join(directory, "attempts");
    const clock = join(directory, "elapsed-seconds");
    const archive = "Prepared first publication archive";
    const { createHash } = await import("node:crypto");
    const expected = `sha512-${createHash("sha512").update(archive).digest("base64")}`;

    try {
      await mkdir(bin);
      await mkdir(join(directory, "bootstrap"));
      await writeFile(join(directory, "bootstrap", "sync.tgz"), archive);
      await writeFile(record, "0\n");
      await writeFile(clock, "0\n");
      await writeFile(join(bin, "package.json"), '{"type":"module"}');
      await writeFile(
        join(bin, "npm"),
        `#!/bin/sh
read -r count < "$PUBLISH_RECORD"
printf '%s\n' "$((count + 1))" > "$PUBLISH_RECORD"
read -r elapsed < "$REGISTRY_CLOCK"
if [ "$REGISTRY_SCENARIO" = unavailable ]; then exit 1; fi
if [ "$REGISTRY_SCENARIO" = delayed-visibility ] && [ "$elapsed" -lt 300 ]; then exit 1; fi
printf '%s\n' "$REGISTRY_INTEGRITY"
`,
        { mode: 0o755 },
      );
      await writeFile(
        join(bin, "sleep"),
        '#!/bin/sh\nread -r elapsed < "$REGISTRY_CLOCK"\nprintf \'%s\\n\' "$((elapsed + $1))" > "$REGISTRY_CLOCK"\n',
        { mode: 0o755 },
      );
      const child = Bun.spawn(["bash", "-eu", "-c", script], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          NODE_AUTH_TOKEN: undefined,
          NPM_TOKEN: undefined,
          PUBLISH_RECORD: record,
          REGISTRY_CLOCK: clock,
          REGISTRY_SCENARIO: scenario,
          REGISTRY_INTEGRITY: scenario === "wrong-integrity" ? "sha512-wrong" : expected,
          PACKAGE_NAME: "@cueloop/sync",
          VERSION: "0.0.0",
          TARBALL: "sync.tgz",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);

      expect(status, errors).toBe(scenario === "delayed-visibility" ? 0 : 1);

      if (scenario === "wrong-integrity") {
        expect(Number(await readFile(record, "utf8"))).toBe(1);
        expect(Number(await readFile(clock, "utf8"))).toBe(0);
      } else if (scenario === "unavailable") {
        expect(errors).toContain(
          "Published tarball was not visible before the verification deadline",
        );
        expect(Number(await readFile(clock, "utf8"))).toBe(900);
      } else {
        expect(Number(await readFile(record, "utf8"))).toBeGreaterThan(1);
        expect(Number(await readFile(clock, "utf8"))).toBe(300);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
