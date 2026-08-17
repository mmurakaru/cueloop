import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { isolateUserConfig } from "./test-support";

describe("isolateUserConfig", () => {
  test("loadConfig sees defaults while isolated and the env is restored after", () => {
    // Arrange
    const home = mkdtempSync(join(tmpdir(), "cueloop-isolate-"));
    const userConfigPath = join(home, "config.toml");
    writeFileSync(userConfigPath, '[ui]\nreview_state = "compact"\n');
    const priorEnv = process.env.CUELOOP_CONFIG;
    process.env.CUELOOP_CONFIG = userConfigPath;

    try {
      // Act
      const restoreUserConfig = isolateUserConfig(home);
      const isolated = loadConfig({ repoRoot: home });
      restoreUserConfig();
      const restored = loadConfig({ repoRoot: home });

      // Assert
      expect(isolated.ui.reviewState).toBe("expanded");
      expect(process.env.CUELOOP_CONFIG).toBe(userConfigPath);
      expect(restored.ui.reviewState).toBe("compact");
    } finally {
      if (priorEnv === undefined) delete process.env.CUELOOP_CONFIG;
      else process.env.CUELOOP_CONFIG = priorEnv;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("restore removes the variable when nothing was set before", () => {
    // Arrange
    const home = mkdtempSync(join(tmpdir(), "cueloop-isolate-"));
    const priorEnv = process.env.CUELOOP_CONFIG;
    delete process.env.CUELOOP_CONFIG;

    try {
      // Act
      const restoreUserConfig = isolateUserConfig(home);
      const pointedAt = process.env.CUELOOP_CONFIG ?? "";
      restoreUserConfig();

      // Assert
      expect(pointedAt).toBe(join(home, "no-config.toml"));
      expect(process.env.CUELOOP_CONFIG).toBeUndefined();
    } finally {
      if (priorEnv !== undefined) process.env.CUELOOP_CONFIG = priorEnv;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
