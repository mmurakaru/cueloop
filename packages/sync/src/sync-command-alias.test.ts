import { expect, test } from "bun:test";
import {
  mkdtemp,
  writeFile,
  mkdir,
  readFile,
  readlink,
  symlink,
  lstat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSyncCommandAlias } from "./sync-command-alias.ts";

test("the optional shortcut runs the standalone CLI and repeated installation preserves its link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cueloop-sync-alias-"));
  const executablePath = new URL("../bin/cueloop-sync.js", import.meta.url).pathname;

  try {
    expect(
      await installSyncCommandAlias({ directory, executablePath, searchPath: directory }),
    ).toMatchObject({ status: "installed" });
    const child = Bun.spawn([join(directory, "cs"), "--help"], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text();

    expect(await child.exited).toBe(0);
    expect(output).toContain("General-purpose sync for terminals");
    expect(
      await installSyncCommandAlias({ directory, executablePath, searchPath: directory }),
    ).toMatchObject({ status: "already-installed" });
    expect(await readlink(join(directory, "cs"))).toBe(executablePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const kind of ["file", "directory", "dangling-link", "path-executable"] as const) {
  test(`alias installation preserves an existing ${kind}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cueloop-sync-alias-conflict-"));
    const destination = join(directory, "destination");
    const pathDirectory = join(directory, "existing-bin");
    const executablePath = new URL("../bin/cueloop-sync.js", import.meta.url).pathname;
    const conflict = join(kind === "path-executable" ? pathDirectory : destination, "cs");

    try {
      await mkdir(destination);
      await mkdir(pathDirectory);

      if (kind === "directory") await mkdir(conflict);
      else if (kind === "dangling-link") await symlink(join(directory, "absent"), conflict);
      else await writeFile(conflict, "#!/bin/sh\nexit 17\n", { mode: 0o755 });

      expect(
        await installSyncCommandAlias({
          directory: destination,
          executablePath,
          searchPath: pathDirectory,
        }),
      ).toMatchObject({ status: "preserved", path: conflict });

      if (kind === "directory") expect((await lstat(conflict)).isDirectory()).toBe(true);
      else if (kind === "dangling-link")
        expect(await readlink(conflict)).toBe(join(directory, "absent"));
      else expect(await readFile(conflict, "utf8")).toContain("exit 17");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const existing of [false, true]) {
  test(`the standalone alias command ${existing ? "preserves a collision" : "installs the shortcut"}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cueloop-sync-alias-command-"));
    const executablePath = new URL("../bin/cueloop-sync.js", import.meta.url).pathname;
    const nodeExecutable = Bun.which("node");

    if (!nodeExecutable) throw new Error("The alias integration check requires Node");

    try {
      if (existing)
        await writeFile(join(directory, "cs"), "Keep the existing command", { mode: 0o755 });

      const child = Bun.spawn(
        [nodeExecutable, executablePath, "alias", "install", "--directory", directory],
        { env: { ...process.env, PATH: directory }, stdout: "pipe", stderr: "pipe" },
      );
      const [output, errors, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect(status, errors).toBe(existing ? 1 : 0);
      expect(JSON.parse(output)).toMatchObject({
        status: existing ? "preserved" : "installed",
        command: "cueloop-sync",
      });

      if (existing)
        expect(await readFile(join(directory, "cs"), "utf8")).toBe("Keep the existing command");
      else expect(await readlink(join(directory, "cs"))).toBe(executablePath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
