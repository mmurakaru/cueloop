/**
 * `cueloop update` end to end, against a real compiled single-file binary. The
 * install-dir bug only exists in a Bun-compiled executable: `argv[1]` there is
 * the virtual `/$bunfs/root/cueloop`, so a naive resolver would try to install
 * into a read-only filesystem. `update --dry-run` resolves and reports the
 * target without any network work, so this proves the compiled binary targets
 * its own real on-disk directory and never `/$bunfs`.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "packages", "cli", "src", "main.ts");

let installRoot: string;
let binaryPath: string;

beforeAll(async () => {
  installRoot = mkdtempSync(join(tmpdir(), "cueloop-update-"));
  binaryPath = join(installRoot, "cueloop");
  const build = Bun.spawn(
    ["bun", "build", "--compile", "--external", "cpu-features", CLI_ENTRY, "--outfile", binaryPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await build.exited;

  if (code !== 0) throw new Error(await new Response(build.stderr).text());
});
afterAll(() => {
  rmSync(installRoot, { recursive: true, force: true });
});

test("the compiled binary resolves its install target to its own directory, never /$bunfs", async () => {
  const proc = Bun.spawn([binaryPath, "update", "--dry-run"], {
    env: { ...process.env, CUELOOP_INSTALL_DIR: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

  // realpath canonicalizes the macOS /var -> /private/var symlink, which the
  // binary's own path resolution also applies.
  expect(code).toBe(0);
  expect(stderr).toContain(`cueloop would update in ${realpathSync(installRoot)}`);
  expect(stderr).not.toContain("$bunfs");
});
