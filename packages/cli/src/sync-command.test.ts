import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.each([true, false])(
  "sync honors repository settings from a subdirectory (%s)",
  async (enabled) => {
    const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-command-"));
    const subdirectory = join(directory, "src");
    const userConfiguration = join(directory, "user.toml");

    mkdirSync(subdirectory);
    mkdirSync(join(directory, ".cueloop"));
    writeFileSync(userConfiguration, `[experimental]\nsync = ${!enabled}\n`);
    writeFileSync(
      join(directory, ".cueloop", "config.toml"),
      `[experimental]\nsync = ${enabled}\n`,
    );
    const git = Bun.spawnSync(["git", "init", "--quiet", directory]);

    expect(git.exitCode).toBe(0);

    try {
      const child = Bun.spawn(
        [process.execPath, resolve("packages/cli/src/main.ts"), "sync", "--help"],
        {
          cwd: subdirectory,
          env: { ...process.env, CUELOOP_CONFIG: userConfiguration },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [output, error, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(status).toBe(enabled ? 0 : 1);
      expect(enabled ? output : error).toContain(
        enabled ? "General-purpose sync for terminals" : "enable it in Settings",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
