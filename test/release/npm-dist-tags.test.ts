import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

for (const scenario of ["success", "denied", "stable"] as const) {
  test(`release tags ${scenario} use only tag operations and preserve npm errors`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cueloop-release-tags-"));
    const script = resolve("scripts/sync-dist-tags.ts");
    const commands = join(directory, "commands.jsonl");
    const version = scenario === "stable" ? "1.0.0" : "0.1.0-alpha.119";

    try {
      await mkdir(join(directory, "bin"));
      for (const [path, name, privatePackage] of [
        ["cli", "cueloop", false],
        ["schema", "@cueloop/schema", false],
        ["integrations/obsidian", "@cueloop/integration-obsidian", false],
        ["gateway", "@cueloop/gateway", true],
      ] as const) {
        const packageDirectory = join(directory, "packages", path);

        await mkdir(packageDirectory, { recursive: true });
        await writeFile(
          join(packageDirectory, "package.json"),
          JSON.stringify({ name, version, private: privatePackage }),
        );
      }
      await writeFile(
        join(directory, "bin", "npm"),
        String.raw`#!/usr/bin/env node
const {appendFileSync} = require('node:fs');
const argumentsList = process.argv.slice(2);
appendFileSync(process.env.TAG_COMMANDS, JSON.stringify(argumentsList) + '\n');
if (process.env.TAG_SCENARIO === 'denied' && argumentsList[2]?.startsWith('@cueloop/schema@')) {
  console.error('npm error code E403\nnpm error Trusted publisher cannot manage dist-tags\nnpm error A complete log is in npm-debug.log');
  process.exitCode = 1;
}
`,
        { mode: 0o755 },
      );
      const child = Bun.spawn([process.execPath, "run", script], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${join(directory, "bin")}:${process.env.PATH}`,
          NODE_AUTH_TOKEN: undefined,
          NPM_TOKEN: undefined,
          TAG_COMMANDS: commands,
          TAG_SCENARIO: scenario,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, output, errors] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(status, output + errors).toBe(scenario === "denied" ? 1 : 0);

      if (scenario === "stable") {
        expect(await Bun.file(commands).exists()).toBe(false);
      } else {
        const recorded = (await readFile(commands, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));

        expect(recorded.sort()).toEqual(
          ["cueloop", "@cueloop/schema", "@cueloop/integration-obsidian"]
            .map((name) => ["dist-tag", "add", `${name}@${version}`, "alpha"])
            .sort(),
        );
      }

      if (scenario === "denied") {
        expect(output + errors).toContain("E403");
        expect(output + errors).toContain("Trusted publisher cannot manage dist-tags");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
