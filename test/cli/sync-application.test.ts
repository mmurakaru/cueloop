import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hermeticCueloopEnvironment } from "../helpers/env";

test("sync applications load installed SDK exports through their package manifest", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-sync-application-"));
  const application = join(home, "application.ts");
  const configuration = join(home, "experimental.toml");
  const executable = process.env.CUELOOP_TEST_EXECUTABLE;
  const command = executable
    ? [resolve(executable)]
    : [process.execPath, "run", resolve("packages/cli/src/main.ts")];

  try {
    mkdirSync(join(home, "node_modules", "@cueloop"), { recursive: true });
    symlinkSync(resolve("packages/sync"), join(home, "node_modules", "@cueloop", "sync"), "dir");
    writeFileSync(configuration, "[experimental]\nsync = true\n");
    writeFileSync(
      application,
      `import { createSyncTextState } from "@cueloop/sync/text";
export const syncApplication = {
  fetch: () => new Response("ok"),
  connect: async () => {
    console.log(createSyncTextState("Imported shared text").text);
    return { status: "completed" };
  },
};`,
    );
    const child = Bun.spawn([...command, "sync", "connect", "--application", application], {
      cwd: home,
      env: hermeticCueloopEnvironment(home, { CUELOOP_CONFIG: configuration }),
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(15_000),
    });
    const [output, errors, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(status, errors).toBe(0);
    expect(output).toBe("Imported shared text\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
