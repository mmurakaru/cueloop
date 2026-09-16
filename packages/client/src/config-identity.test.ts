import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, persistIdentity } from "./config";

function withTempConfig(run: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-config-"));

  try {
    run(join(directory, "config.toml"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("defaults identity to a typed provider with no name", () => {
  withTempConfig((path) => {
    expect(loadConfig({ userConfigPath: path }).identity).toEqual({ provider: "typed" });
  });
});

test("persists and reloads a GitHub-synced identity", () => {
  withTempConfig((path) => {
    persistIdentity({ name: "Markus M", provider: "github" }, path);

    expect(loadConfig({ userConfigPath: path }).identity).toEqual({
      name: "Markus M",
      provider: "github",
    });
  });
});

test("rewrites the identity block in place on a re-sync", () => {
  withTempConfig((path) => {
    persistIdentity({ name: "typed name", provider: "typed" }, path);
    persistIdentity({ name: "markus", provider: "github" }, path);

    expect(loadConfig({ userConfigPath: path }).identity).toEqual({
      name: "markus",
      provider: "github",
    });
  });
});

test("a display name containing a bracket survives a re-sync without corrupting the config", () => {
  withTempConfig((path) => {
    persistIdentity({ name: "Alice [Smith]", provider: "typed" }, path);
    persistIdentity({ name: "Bob", provider: "github" }, path);

    expect(loadConfig({ userConfigPath: path }).identity).toEqual({
      name: "Bob",
      provider: "github",
    });
  });
});

test("repository config cannot forge the reviewer identity", () => {
  withTempConfig((userPath) => {
    persistIdentity({ name: "Me", provider: "typed" }, userPath);
    const repoRoot = mkdtempSync(join(tmpdir(), "cueloop-repo-"));

    try {
      mkdirSync(join(repoRoot, ".cueloop"), { recursive: true });
      writeFileSync(
        join(repoRoot, ".cueloop", "config.toml"),
        '[identity]\nname = "Forged"\nprovider = "github"\n',
      );

      expect(loadConfig({ userConfigPath: userPath, repoRoot }).identity).toEqual({
        name: "Me",
        provider: "typed",
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
