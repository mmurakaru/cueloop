import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "@cueloop/schema";
import { createTerminalThreadSurfacePort } from "./terminal-thread-surface-port";

const dir = mkdtempSync(join(tmpdir(), "cueloop-terminal-port-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("Herdr owns the placement when nested inside Ghostty", async () => {
  const configPath = join(dir, "config.toml");

  writeFileSync(
    configPath,
    '[integrations.herdr]\nthread_surface = "none"\n[integrations.ghostty]\nthread_surface = "tab"\n',
  );
  const thread: Thread = {
    schemaVersion: "1",
    id: "ses_one",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan", meta: {} },
    revisions: [{ revision: 1, content: "# Plan", submittedAt: "now" }],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "now",
  };
  const persistence = {
    herdrGetThreadSurface: async () => null,
    herdrSetThreadSurface: async () => {},
    ghosttyGetThreadSurface: async () => null,
    ghosttySetThreadSurface: async () => {},
    ghosttyClaimThreadSurface: async () => true,
    ghosttyReleaseThreadSurface: async () => {},
  };
  const port = createTerminalThreadSurfacePort(
    persistence,
    {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "pane-1",
      TERM_PROGRAM: "ghostty",
      GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app",
    },
    configPath,
  );

  expect(await port.openThreads(thread.id, "thread", thread)).toBe("disabled");
});
