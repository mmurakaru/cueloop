import { basename, dirname, isAbsolute, resolve } from "node:path";
import * as v from "valibot";
import { CLI_VERSION } from "./version";

const INSTALL_URL = "https://cueloop.dev/install.sh";
const RELEASES_URL = "https://api.github.com/repos/mmurakaru/cueloop/releases?per_page=100";
const RELEASE_TAG_PREFIX = "cueloop@";

const InstallerScriptSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.check(
    (script) => script.includes("CUELOOP_INSTALL_DIR"),
    "installer is not a cueloop installer",
  ),
);

const ReleasesSchema = v.array(v.object({ tag_name: v.nullish(v.string()) }));

function userBinInstallDir(env: NodeJS.ProcessEnv): string | undefined {
  if (env.HOME === undefined) return undefined;

  return `${env.HOME}/.local/bin`;
}

/**
 * The directory that holds the running binary, or undefined when we are not the
 * compiled cueloop. Reads `execPath` (the real on-disk executable), not
 * `argv[1]`: a Bun single-file executable reports its virtual filesystem path
 * (`/$bunfs/root/cueloop`) in `argv[1]`, and installing there fails with a
 * read-only filesystem error. The `/$bunfs` guard is belt-and-braces.
 */
function invokedBinaryInstallDir(execPath: string): string | undefined {
  if (basename(execPath) !== "cueloop") return undefined;

  const dir = dirname(isAbsolute(execPath) ? execPath : resolve(execPath));

  if (dir === "/$bunfs" || dir.startsWith("/$bunfs/")) return undefined;

  return dir;
}

/** Where an update should land: an explicit override, else the binary's own directory, else the per-user bin dir. */
export function resolveInstallDir(execPath: string, env: NodeJS.ProcessEnv): string | undefined {
  return env.CUELOOP_INSTALL_DIR || invokedBinaryInstallDir(execPath) || userBinInstallDir(env);
}

/** The newest published cueloop version, or undefined when the releases API is unreachable or empty. */
async function fetchLatestVersion(): Promise<string | undefined> {
  try {
    const response = await fetch(RELEASES_URL, { headers: { "user-agent": "cueloop-update" } });

    if (!response.ok) return undefined;
    const parsed = v.safeParse(ReleasesSchema, await response.json());

    if (!parsed.success) return undefined;

    for (const release of parsed.output) {
      if (release.tag_name?.startsWith(RELEASE_TAG_PREFIX)) {
        return release.tag_name.slice(RELEASE_TAG_PREFIX.length);
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/** True when `latest` is strictly newer than `current`; unparseable versions fall through to attempting the update. */
function isNewer(latest: string, current: string): boolean {
  try {
    return Bun.semver.order(latest, current) === 1;
  } catch {
    return true;
  }
}

/** Fetch the published installer and run it, targeting `targetInstallDir`; returns the installer's exit code. */
async function runInstaller(targetInstallDir: string): Promise<number> {
  try {
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

export interface UpdateDeps {
  currentVersion: string;
  installDir: () => string | undefined;
  fetchLatestVersion: () => Promise<string | undefined>;
  runInstaller: (targetInstallDir: string) => Promise<number>;
  out: (message: string) => void;
}

/**
 * The update flow, over injectable dependencies: resolve the target directory,
 * report the current version, and either report that we are up to date or re-run
 * the installer. `--dry-run` resolves and reports the target without any network
 * work, which is how the compiled-binary path resolution gets tested.
 */
export async function runUpdate(deps: UpdateDeps, dryRun: boolean): Promise<number> {
  const targetInstallDir = deps.installDir();

  if (targetInstallDir === undefined) {
    deps.out("cueloop update: HOME is not set and the current binary path is unknown");

    return 1;
  }
  if (!targetInstallDir.startsWith("/")) {
    deps.out("cueloop update: CUELOOP_INSTALL_DIR must be an absolute path");

    return 1;
  }
  deps.out(`Current version: ${deps.currentVersion}`);

  if (dryRun) {
    deps.out(`cueloop would update in ${targetInstallDir}`);

    return 0;
  }
  deps.out("Checking for updates to latest version...");
  const latest = await deps.fetchLatestVersion();

  if (latest !== undefined && !isNewer(latest, deps.currentVersion)) {
    deps.out(`cueloop is up to date (${deps.currentVersion})`);

    return 0;
  }
  deps.out(`updating cueloop in ${targetInstallDir}...`);
  const exitCode = await deps.runInstaller(targetInstallDir);

  if (exitCode === 0) deps.out("Update ran successfully! Please restart cueloop.");

  return exitCode;
}

/** `cueloop update [--dry-run]` - update the installed cueloop binary in place. */
export async function updateCommand(argv: string[] = []): Promise<number> {
  return runUpdate(
    {
      currentVersion: CLI_VERSION,
      installDir: () => resolveInstallDir(process.execPath, process.env),
      fetchLatestVersion,
      runInstaller,
      out: (message) => console.error(message),
    },
    argv.includes("--dry-run"),
  );
}
