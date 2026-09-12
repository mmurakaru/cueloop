import { basename, dirname, isAbsolute, resolve } from "node:path";
import * as v from "valibot";

const INSTALL_URL = "https://cueloop.dev/install.sh";
const InstallerScriptSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.check(
    (script) => script.includes("CUELOOP_INSTALL_DIR"),
    "installer is not a cueloop installer",
  ),
);

function userBinInstallDir(): string | undefined {
  if (process.env.HOME === undefined) return undefined;

  return `${process.env.HOME}/.local/bin`;
}

function invokedBinaryInstallDir(): string | undefined {
  const invokedPath = process.argv[1];
  if (invokedPath === undefined || basename(invokedPath) !== "cueloop") return undefined;

  return dirname(isAbsolute(invokedPath) ? invokedPath : resolve(invokedPath));
}

function defaultInstallDir(): string | undefined {
  return invokedBinaryInstallDir() ?? userBinInstallDir();
}

function installDir(): string | undefined {
  return process.env.CUELOOP_INSTALL_DIR || defaultInstallDir();
}

/** Re-run the published installer into the directory that holds this binary. */
export async function updateCommand(): Promise<number> {
  const targetInstallDir = installDir();

  if (targetInstallDir === undefined) {
    console.error("cueloop update: HOME is not set and the current binary path is unknown");

    return 1;
  }
  if (!targetInstallDir.startsWith("/")) {
    console.error("cueloop update: CUELOOP_INSTALL_DIR must be an absolute path");

    return 1;
  }

  try {
    console.error(`updating cueloop in ${targetInstallDir}...`);
    const response = await fetch(INSTALL_URL);

    if (!response.ok) {
      console.error(`cueloop update: failed to fetch installer (${response.status})`);

      return 1;
    }
    const parsed = v.safeParse(InstallerScriptSchema, await response.text());

    if (!parsed.success) {
      console.error("cueloop update: fetched installer failed validation");

      return 1;
    }
    const child = Bun.spawn(["sh"], {
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, CUELOOP_INSTALL_DIR: targetInstallDir },
    });

    child.stdin.write(parsed.output);
    child.stdin.end();

    return child.exited;
  } catch (error) {
    console.error(`cueloop update: ${error instanceof Error ? error.message : String(error)}`);

    return 1;
  }
}
