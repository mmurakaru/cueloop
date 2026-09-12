/** update install-dir resolution and the update flow over injected deps: never the Bun `/$bunfs` path, an up-to-date short-circuit, and a restart notice on success. */

import { describe, expect, mock, test } from "bun:test";
import { resolveInstallDir, runUpdate, type UpdateDeps } from "./update-command";

function depsSpy(overrides: Partial<UpdateDeps> = {}): UpdateDeps & { lines: string[] } {
  const lines: string[] = [];

  return {
    currentVersion: "0.1.0-alpha.68",
    installDir: () => "/Users/dev/.local/bin",
    fetchLatestVersion: mock(async () => "0.1.0-alpha.68"),
    runInstaller: mock(async () => 0),
    out: (message: string) => void lines.push(message),
    lines,
    ...overrides,
  };
}

describe("resolveInstallDir", () => {
  test("rejects the Bun single-file virtual path and falls back to the per-user bin dir", () => {
    // Arrange - a compiled binary that mistakenly reports its bunfs path
    const env: NodeJS.ProcessEnv = { HOME: "/Users/dev" };

    // Act
    const dir = resolveInstallDir("/$bunfs/root/cueloop", env);

    // Assert
    expect(dir).toBe("/Users/dev/.local/bin");
  });

  test("uses the real on-disk directory of the invoked binary", () => {
    // Arrange
    const env: NodeJS.ProcessEnv = { HOME: "/Users/dev" };

    // Act
    const dir = resolveInstallDir("/usr/local/bin/cueloop", env);

    // Assert
    expect(dir).toBe("/usr/local/bin");
  });

  test("falls back to the per-user bin dir when not running as the compiled cueloop", () => {
    // Arrange - execPath is the bun runtime, not cueloop
    const env: NodeJS.ProcessEnv = { HOME: "/Users/dev" };

    // Act
    const dir = resolveInstallDir("/Users/dev/.bun/bin/bun", env);

    // Assert
    expect(dir).toBe("/Users/dev/.local/bin");
  });

  test("an explicit CUELOOP_INSTALL_DIR overrides everything", () => {
    // Arrange
    const env: NodeJS.ProcessEnv = { HOME: "/Users/dev", CUELOOP_INSTALL_DIR: "/opt/bin" };

    // Act
    const dir = resolveInstallDir("/$bunfs/root/cueloop", env);

    // Assert
    expect(dir).toBe("/opt/bin");
  });
});

describe(runUpdate, () => {
  test("--dry-run reports the target without any network or install work", async () => {
    // Arrange
    const deps = depsSpy();

    // Act
    const code = await runUpdate(deps, true);

    // Assert
    expect(code).toBe(0);
    expect(deps.lines).toEqual([
      "Current version: 0.1.0-alpha.68",
      "cueloop would update in /Users/dev/.local/bin",
    ]);
    expect(deps.fetchLatestVersion).not.toHaveBeenCalled();
    expect(deps.runInstaller).not.toHaveBeenCalled();
  });

  test("reports up to date and skips the installer when no newer version exists", async () => {
    // Arrange - latest matches the current version
    const deps = depsSpy({ fetchLatestVersion: mock(async () => "0.1.0-alpha.68") });

    // Act
    const code = await runUpdate(deps, false);

    // Assert
    expect(code).toBe(0);
    expect(deps.lines).toContain("cueloop is up to date (0.1.0-alpha.68)");
    expect(deps.runInstaller).not.toHaveBeenCalled();
  });

  test("does not downgrade when the newest release is older than the current build", async () => {
    // Arrange - a dev build ahead of the published release
    const deps = depsSpy({
      currentVersion: "0.1.0-alpha.69",
      fetchLatestVersion: mock(async () => "0.1.0-alpha.68"),
    });

    // Act
    const code = await runUpdate(deps, false);

    // Assert
    expect(code).toBe(0);
    expect(deps.runInstaller).not.toHaveBeenCalled();
  });

  test("runs the installer and prints a restart notice when a newer version exists", async () => {
    // Arrange
    const deps = depsSpy({ fetchLatestVersion: mock(async () => "0.1.0-alpha.99") });

    // Act
    const code = await runUpdate(deps, false);

    // Assert
    expect(code).toBe(0);
    expect(deps.runInstaller).toHaveBeenCalledWith("/Users/dev/.local/bin");
    expect(deps.lines).toContain("Update ran successfully! Please restart cueloop.");
  });

  test("proceeds with the update when the latest version cannot be determined", async () => {
    // Arrange - releases API unreachable
    const deps = depsSpy({ fetchLatestVersion: mock(async () => undefined) });

    // Act
    await runUpdate(deps, false);

    // Assert
    expect(deps.runInstaller).toHaveBeenCalledTimes(1);
  });

  test("does not print the restart notice when the installer fails", async () => {
    // Arrange
    const deps = depsSpy({
      fetchLatestVersion: mock(async () => "0.1.0-alpha.99"),
      runInstaller: mock(async () => 1),
    });

    // Act
    const code = await runUpdate(deps, false);

    // Assert
    expect(code).toBe(1);
    expect(deps.lines).not.toContain("Update ran successfully! Please restart cueloop.");
  });

  test("rejects a relative install dir before doing any work", async () => {
    // Arrange
    const deps = depsSpy({ installDir: () => "relative/dir" });

    // Act
    const code = await runUpdate(deps, false);

    // Assert
    expect(code).toBe(1);
    expect(deps.lines[0]).toContain("must be an absolute path");
    expect(deps.runInstaller).not.toHaveBeenCalled();
  });
});
