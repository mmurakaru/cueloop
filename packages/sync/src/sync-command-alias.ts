import { readSyncCommandFlag } from "./sync-command-arguments.ts";
import { access, mkdir, realpath, stat, symlink } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import * as v from "valibot";

async function findSyncCommandOnPath(path: string): Promise<string | undefined> {
  for (const directory of path.split(delimiter)) {
    const candidate = resolve(directory, "cs");

    try {
      await access(candidate, constants.X_OK);

      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }

  return undefined;
}

/** Alias installation creates a link exclusively and preserves existing commands, including on PATH. */
export async function installSyncCommandAlias(options: {
  directory: string;
  executablePath: string;
  searchPath?: string;
}) {
  const directory = resolve(v.parse(v.pipe(v.string(), v.minLength(1)), options.directory));
  const executable = await realpath(options.executablePath);
  const path = join(directory, "cs");
  const existing = await findSyncCommandOnPath(options.searchPath ?? process.env.PATH ?? "");

  if (existing) {
    const same = await realpath(existing).then(
      (target) => target === executable,
      () => false,
    );

    return {
      status: same ? ("already-installed" as const) : ("preserved" as const),
      path: existing,
      command: "cueloop-sync",
    };
  }

  await mkdir(directory, { recursive: true });

  try {
    await symlink(executable, path, "file");

    return { status: "installed" as const, path, command: "cueloop-sync" };
  } catch (cause) {
    if (!v.is(v.object({ code: v.literal("EEXIST") }), cause)) throw cause;

    const same = await realpath(path).then(
      (target) => target === executable,
      () => false,
    );

    return {
      status: same ? ("already-installed" as const) : ("preserved" as const),
      path,
      command: "cueloop-sync",
    };
  }
}

export async function runSyncAliasCli(
  arguments_: string[],
  executablePath?: string,
): Promise<number> {
  const command = arguments_[0];

  if (!command || arguments_.includes("--help")) {
    process.stdout.write("Usage: cueloop-sync alias install --directory <bin-directory>\n");

    return 0;
  }

  if (command !== "install") throw new Error("Sync alias command is unknown");

  if (!executablePath)
    throw new Error("Run cueloop-sync alias install from the standalone executable");

  const result = await installSyncCommandAlias({
    directory: readSyncCommandFlag(arguments_, "--directory"),
    executablePath,
  });

  process.stdout.write(JSON.stringify(result) + "\n");

  return result.status === "preserved" ? 1 : 0;
}
