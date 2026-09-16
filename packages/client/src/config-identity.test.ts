import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
