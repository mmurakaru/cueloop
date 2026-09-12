/**
 * The curl installer end to end against an offline release server: structure
 * rules, platform detection, the happy path under every shell on the machine,
 * idempotent reruns, rc-file PATH edits, and every failure path. Runs in the
 * default test group; no network, no real binary.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BAD_CHECKSUM_VERSION,
  GOOD_VERSION,
  MISSING_ASSET_VERSION,
  NO_CHECKSUMS_VERSION,
  RELEASE_ASSETS,
  startTestReleaseServer,
  testBinaryScript,
  type TestReleaseServer,
} from "../helpers/install-fixtures";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const INSTALLER = join(REPO_ROOT, "site", "public", "install.sh");
const RELEASE_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "release.yml");

/** The POSIX shells present on this machine; dash is Linux-only, zsh and bash are everywhere. */
const SHELLS = ["sh", "bash", "zsh", "dash"].filter((shell) => Bun.which(shell) !== null);

interface ShellRun {
  code: number;
  stderr: string;
}

async function runShell(
  command: string[],
  env: Record<string, string>,
  stdin?: string,
): Promise<ShellRun> {
  const proc = Bun.spawn(command, {
    env,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

  return { code, stderr };
}

let server: TestReleaseServer;

beforeEach(() => {
  server = startTestReleaseServer();
});

afterEach(() => {
  server.close();
});

/** Run the installer against the release server with env `overrides` on top of the offline defaults. */
function runInstaller(
  overrides: Record<string, string> = {},
  options: { shell?: string; args?: string[]; unsetHome?: boolean } = {},
): Promise<ShellRun> {
  const env = server.environment(overrides);

  if (options.unsetHome) delete env.HOME;

  return runShell([options.shell ?? "sh", INSTALLER, ...(options.args ?? [])], env);
}

function installerLines(): string[] {
  return readFileSync(INSTALLER, "utf8").trimEnd().split("\n");
}

/** What `detect_platform` produces when `uname` reports the given system and machine. */
function detectPlatform(system: string, machine: string): Promise<ShellRun> {
  // the library half: everything except the final `main "$@"`, with uname shadowed
  const script = `
uname() { case "$1" in -s) printf '%s\\n' '${system}' ;; -m) printf '%s\\n' '${machine}' ;; esac; }
${installerLines().slice(0, -1).join("\n")}
detect_platform
printf '%s\\n' "$asset" >&2
`;

  return runShell(["sh", "-c", script], server.environment());
}

/** A PATH holding only the tools the installer needs, minus `without`, so an absent tool is provable. */
function toolsPath(without: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-install-tools-"));
  const tools = [
    "sh",
    "uname",
    "mktemp",
    "grep",
    "sed",
    "awk",
    "head",
    "mkdir",
    "mv",
    "rm",
    "chmod",
    "dirname",
    "basename",
    "sleep",
    "curl",
    "wget",
    "sha256sum",
    "shasum",
  ].filter((tool) => !without.includes(tool));

  for (const tool of tools) {
    const resolved = Bun.which(tool);

    if (resolved) symlinkSync(resolved, join(directory, tool));
  }

  return directory;
}

function installedVersion(): string {
  return Bun.spawnSync([server.installedBinary, "--version"]).stdout.toString().trim();
}

function expectCleanExit(result: ShellRun): void {
  expect(result.stderr).not.toContain("cueloop install failed");
  expect(result.code).toBe(0);
}

describe("installer structure", () => {
  test("parses under sh and runs nothing before its last line", async () => {
    // When checked with the shell's parser
    const parse = await runShell(["sh", "-n", INSTALLER], server.environment());

    // Then it parses and ends with the single call into main, so a truncated pipe dies on syntax
    expect(parse.code).toBe(0);
    expect(installerLines().at(-1)).toBe('main "$@"');
  });

  test("names exactly the assets the release workflow uploads", () => {
    // Given the release build matrix
    const targets = [...readFileSync(RELEASE_WORKFLOW, "utf8").matchAll(/- target: (\S+)/g)].map(
      (match) => `cueloop-${match[1]}`,
    );

    // Then the fixture and the installer's platform table agree with it; the workflow may list a target in more than one matrix
    expect([...new Set(targets)].toSorted()).toEqual(RELEASE_ASSETS.toSorted());
  });

  test("keeps the env seams the update command relies on", () => {
    // Given the update command validates the fetched script by this marker and sets both vars
    const script = readFileSync(INSTALLER, "utf8");

    expect(script).toContain("CUELOOP_INSTALL_DIR");
    expect(script).toContain("CUELOOP_NO_MODIFY_PATH");
  });
});

describe("platform detection", () => {
  test("maps every supported uname pair to a release asset", async () => {
    // Given the four published platforms
    const pairs: [string, string, string][] = [
      ["Darwin", "arm64", "cueloop-darwin-arm64"],
      ["Darwin", "x86_64", "cueloop-darwin-x64"],
      ["Linux", "aarch64", "cueloop-linux-arm64"],
      ["Linux", "amd64", "cueloop-linux-x64"],
    ];

    for (const [system, machine, asset] of pairs) {
      // When detected
      const result = await detectPlatform(system, machine);

      // Then the asset name matches the release
      expect(result.code).toBe(0);
      expect(result.stderr.trim()).toBe(asset);
    }
  });

  test("rejects an unsupported system or architecture with the npm hint", async () => {
    // When detected on Windows and on a RISC-V Linux
    const windows = await detectPlatform("MINGW64_NT-10.0", "x86_64");
    const riscv = await detectPlatform("Linux", "riscv64");

    // Then both fail and point at npm
    expect(windows.code).toBe(1);
    expect(windows.stderr).toContain("unsupported operating system 'MINGW64_NT-10.0'");
    expect(windows.stderr).toContain("npm i -g cueloop");
    expect(riscv.code).toBe(1);
    expect(riscv.stderr).toContain("unsupported architecture 'riscv64'");
  });
});

describe("a fresh install", () => {
  for (const shell of SHELLS) {
    test(`installs the newest release under ${shell} and hints at PATH`, async () => {
      // When the installer runs with no version pinned
      const result = await runInstaller({}, { shell });

      // Then the binary is in place, runs, and the PATH hint names the install dir
      expectCleanExit(result);
      expect(installedVersion()).toBe(GOOD_VERSION);
      expect(result.stderr).toContain(`${server.installDir} is not on your PATH`);
      expect(result.stderr).toContain(`export PATH="${server.installDir}:$PATH"`);
    });
  }

  test("says so when the directory is already on PATH", async () => {
    // When installed with the install dir already on PATH
    const result = await runInstaller({ PATH: `${server.installDir}:${process.env.PATH}` });

    // Then the hint is the plain start line
    expectCleanExit(result);
    expect(result.stderr).toContain("Run cueloop to get started");
    expect(result.stderr).not.toContain("not on your PATH");
  });

  test("a rerun finds the version installed and downloads nothing", async () => {
    // Given a completed install
    await runInstaller();
    const downloadsBefore = server.requests.filter((path) => path.startsWith("/download/")).length;

    // When run again
    const result = await runInstaller();

    // Then it reports the existing install and makes no download request
    expectCleanExit(result);
    expect(result.stderr).toContain(`cueloop ${GOOD_VERSION} is already installed`);
    expect(server.requests.filter((path) => path.startsWith("/download/")).length).toBe(
      downloadsBefore,
    );
  });

  test("an installed version that merely starts with the requested one is not a match", async () => {
    // Given an installed 900.0.10 and a pin to 900.0.1
    writeFileSync(server.installedBinary, testBinaryScript("900.0.10"));
    chmodSync(server.installedBinary, 0o755);

    // When installed
    const result = await runInstaller({ CUELOOP_VERSION: GOOD_VERSION });

    // Then the pinned version is downloaded and replaces the other
    expectCleanExit(result);
    expect(result.stderr).not.toContain("already installed");
    expect(installedVersion()).toBe(GOOD_VERSION);
  });

  test("a pinned version installs that release, as a bare version or a tag", async () => {
    // When pinned by bare version, then by tag
    const bare = await runInstaller({ CUELOOP_VERSION: GOOD_VERSION });
    const tagged = await runInstaller({ CUELOOP_VERSION: `cueloop@${GOOD_VERSION}` });

    // Then the listing is never read, the bare pin installs, and the tag pin finds it installed
    expectCleanExit(bare);
    expectCleanExit(tagged);
    expect(server.requests).not.toContain("/releases");
    expect(bare.stderr).toContain(`(cueloop@${GOOD_VERSION})`);
    expect(tagged.stderr).toContain("already installed");
  });

  test("an empty pinned version is refused", async () => {
    // When the tag prefix alone is pinned
    const result = await runInstaller({ CUELOOP_VERSION: "cueloop@" });

    // Then nothing is installed and the message names the variable
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("CUELOOP_VERSION must name a version");
    expect(existsSync(server.installedBinary)).toBe(false);
  });

  test("an install directory with a space in it works", async () => {
    // Given a spaced target directory
    const spaced = join(server.installDir, "my tools");

    // When installed
    const result = await runInstaller({ CUELOOP_INSTALL_DIR: spaced });

    // Then the binary lands there
    expectCleanExit(result);
    expect(existsSync(join(spaced, "cueloop"))).toBe(true);
  });

  test("--help prints the options and exits 0, also when piped through sh", async () => {
    // When asked for help by path and through a pipe like `curl | sh -s -- --help`
    const byPath = await runInstaller({}, { args: ["--help"] });
    const piped = await runShell(
      ["sh", "-s", "--", "--help"],
      server.environment(),
      readFileSync(INSTALLER, "utf8"),
    );

    // Then both print the options
    expect(byPath.code).toBe(0);
    expect(byPath.stderr).toContain("CUELOOP_INSTALL_DIR");
    expect(piped.code).toBe(0);
    expect(piped.stderr).toContain("--no-modify-path");
  });

  test("an unknown flag fails and names itself", async () => {
    // When given a typo
    const typo = await runInstaller({}, { args: ["--no-modify-paths"] });

    // Then the error names the flag
    expect(typo.code).toBe(1);
    expect(typo.stderr).toContain("unknown flag '--no-modify-paths'");
  });
});

describe("PATH in the shell rc", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cueloop-install-home-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  /** Overrides that let the installer edit rc files under a temp HOME for the given login shell. */
  function rcOverrides(shell: string) {
    return { HOME: home, SHELL: shell, CUELOOP_NO_MODIFY_PATH: "" };
  }

  test("zsh gets one export line in .zshrc, even across two runs", async () => {
    // When installed twice with zsh as the login shell
    const first = await runInstaller(rcOverrides("/bin/zsh"));
    const second = await runInstaller(rcOverrides("/bin/zsh"));

    // Then the rc holds the line exactly once and the installer says where it wrote it
    expectCleanExit(first);
    expectCleanExit(second);
    const rc = readFileSync(join(home, ".zshrc"), "utf8");
    const line = `export PATH='${server.installDir}':"$PATH"`;

    expect(rc.split("\n").filter((candidate) => candidate === line)).toHaveLength(1);
    expect(first.stderr).toContain(`Added ${server.installDir} to PATH in ${join(home, ".zshrc")}`);
  });

  test("bash prefers an existing .bash_profile over creating .bashrc", async () => {
    // Given only a .bash_profile
    writeFileSync(join(home, ".bash_profile"), "# mine\n");

    // When installed with bash as the login shell
    const result = await runInstaller(rcOverrides("/bin/bash"));

    // Then the line goes into the existing file
    expectCleanExit(result);
    expect(readFileSync(join(home, ".bash_profile"), "utf8")).toContain(
      `export PATH='${server.installDir}':"$PATH"`,
    );
    expect(existsSync(join(home, ".bashrc"))).toBe(false);
  });

  test("fish gets fish_add_path in its config", async () => {
    // When installed with fish as the login shell
    const result = await runInstaller(rcOverrides("/usr/bin/fish"));

    // Then config.fish carries the path command
    expectCleanExit(result);
    expect(readFileSync(join(home, ".config", "fish", "config.fish"), "utf8")).toContain(
      `fish_add_path '${server.installDir}'`,
    );
  });

  test("a GitHub Actions job gets the directory appended to GITHUB_PATH", async () => {
    // Given the Actions PATH file
    const githubPath = join(home, "github_path");

    writeFileSync(githubPath, "");

    // When installed
    const result = await runInstaller({ ...rcOverrides("/bin/bash"), GITHUB_PATH: githubPath });

    // Then the dir is appended and no rc file is touched
    expectCleanExit(result);
    expect(readFileSync(githubPath, "utf8")).toContain(server.installDir);
    expect(existsSync(join(home, ".bashrc"))).toBe(false);
  });

  test("--no-modify-path leaves the rc alone and prints the hint", async () => {
    // When installed with the flag
    const result = await runInstaller(rcOverrides("/bin/zsh"), { args: ["--no-modify-path"] });

    // Then only the hint appears
    expectCleanExit(result);
    expect(existsSync(join(home, ".zshrc"))).toBe(false);
    expect(result.stderr).toContain("is not on your PATH");
  });
});

describe("failure paths", () => {
  test("a checksum mismatch fails and leaves an existing install untouched", async () => {
    // Given a good install
    await runInstaller();
    const before = readFileSync(server.installedBinary, "utf8");

    // When a release with corrupt checksums is pinned
    const result = await runInstaller({ CUELOOP_VERSION: BAD_CHECKSUM_VERSION });

    // Then it refuses and the old binary is byte for byte the same
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("checksum mismatch for cueloop-");
    expect(readFileSync(server.installedBinary, "utf8")).toBe(before);
  });

  test("a release without checksums.txt is refused", async () => {
    // When pinned to it
    const result = await runInstaller({ CUELOOP_VERSION: NO_CHECKSUMS_VERSION });

    // Then the installer refuses an unverified binary
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "has no checksums.txt; refusing to install an unverified binary",
    );
    expect(existsSync(server.installedBinary)).toBe(false);
  });

  test("a release whose asset is missing fails with the npm hint", async () => {
    // When pinned to it
    const result = await runInstaller({ CUELOOP_VERSION: MISSING_ASSET_VERSION });

    // Then the error names the asset and the release
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`in release cueloop@${MISSING_ASSET_VERSION}`);
    expect(result.stderr).toContain("npm i -g cueloop");
  });

  test("an unreachable releases listing fails before anything is written", async () => {
    // When the listing URL is one nobody serves
    const result = await runInstaller({ CUELOOP_RELEASES_API: "http://127.0.0.1:9/releases" });

    // Then the failure is the API, not a checksum or a write
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("could not reach the GitHub releases API");
    expect(existsSync(server.installedBinary)).toBe(false);
  });

  test("no curl and no wget on PATH is a clear failure", async () => {
    // When PATH has neither downloader
    const result = await runInstaller({ PATH: toolsPath(["curl", "wget"]) });

    // Then the installer says what it needs
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("need curl or wget on PATH");
  });

  test("wget alone downloads the release", async () => {
    // Given a PATH whose only downloader is a wget that speaks the flags the installer uses
    const tools = toolsPath(["curl", "wget"]);
    const curl = Bun.which("curl")!;

    writeFileSync(
      join(tools, "wget"),
      `#!/bin/sh\n# wget -qO <file> <url>\n[ "$1" = "-qO" ] || exit 64\nexec '${curl}' -fsSL -o "$2" "$3"\n`,
    );
    chmodSync(join(tools, "wget"), 0o755);

    // When installed
    const result = await runInstaller({ PATH: tools });

    // Then the binary lands through the wget branch
    expectCleanExit(result);
    expect(existsSync(server.installedBinary)).toBe(true);
  });

  test("no sha256 tool refuses to install", async () => {
    // When PATH has neither sha256sum nor shasum
    const result = await runInstaller({ PATH: toolsPath(["sha256sum", "shasum"]) });

    // Then verification is impossible and the install stops
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("need sha256sum or shasum to verify the download");
    expect(existsSync(server.installedBinary)).toBe(false);
  });

  test("an unset HOME is a clear failure, not a stack of shell errors", async () => {
    // When HOME is missing and no install dir is given
    const result = await runInstaller({ CUELOOP_INSTALL_DIR: "" }, { unsetHome: true });

    // Then the message names HOME
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("HOME is not set");
  });

  test("an unwritable install directory fails with the override hint", async () => {
    // Given a read-only target directory
    const readOnly = join(server.installDir, "locked");

    mkdirSync(readOnly);
    chmodSync(readOnly, 0o555);

    // When installed into it
    const result = await runInstaller({ CUELOOP_INSTALL_DIR: readOnly });

    // Then the error points at the override
    chmodSync(readOnly, 0o755);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Re-run with CUELOOP_INSTALL_DIR set to a writable directory");
  });
});
