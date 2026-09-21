import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "@cueloop/schema";
import {
  insideGhostty,
  openGhosttyThreadSurface,
  supportsGhosttyAppleScript,
  GHOSTTY_OPEN_APPLESCRIPT,
  type GhosttyThreadSurfacePersistence,
} from "./ghostty-thread-surface";
import type { GhosttyThreadSurfaceHandle } from "./ghostty-thread-surface-store";

const dir = mkdtempSync(join(tmpdir(), "cueloop-ghostty-thread-surface-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function thread(): Thread {
  return {
    schemaVersion: "1",
    id: "ses_ghostty1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan", meta: { cwd: "/repo/work" } },
    revisions: [{ revision: 1, content: "# Plan", submittedAt: "now" }],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "now",
  };
}

function persistence(initial: GhosttyThreadSurfaceHandle | null = null) {
  let saved = initial;
  const port: GhosttyThreadSurfacePersistence = {
    ghosttyGetThreadSurface: async () => saved,
    ghosttySetThreadSurface: async (_id, handle) => {
      saved = handle;
    },
  };

  return { port, saved: () => saved };
}

function stub(name: string, focusResult = "focused", version = "1.3.1", openFails = false) {
  const binPath = join(dir, `${name}.sh`);
  const logPath = join(dir, `${name}.log`);
  const scriptPath = join(dir, `${name}.applescript`);
  const shellPath = join(dir, `${name}.shell-command`);

  writeFileSync(
    binPath,
    `#!/bin/sh
if [ "$2" = 'tell application "Ghostty" to get version' ]; then
  printf 'version\\n' >> "${logPath}"
  printf '${version}\\n'
  exit 0
fi
printf '%s\\n' "$2" > "${scriptPath}"
if [ "$3" = "ses_previous" ] || [ "$3" = "term-1" ]; then
  printf 'focus:%s\\n' "$3" >> "${logPath}"
  printf '${focusResult}\\n'
  exit 0
fi
printf 'open:%s:%s:%s\\n' "$3" "$4" "$5" >> "${logPath}"
printf '%s\\n' "$6" > "${shellPath}"
${openFails ? "exit 1" : "printf 'term-1\\n'"}
`,
  );
  chmodSync(binPath, 0o755);

  return { binPath, logPath, scriptPath, shellPath };
}

function log(path: string): string[] {
  return readFileSync(path, "utf8").trim().split("\n");
}

describe("Ghostty AppleScript capability", () => {
  test.skipIf(process.platform !== "darwin" || !existsSync("/Applications/Ghostty.app"))(
    "open script compiles against the installed Ghostty dictionary",
    () => {
      const compiled = Bun.spawnSync(
        ["osacompile", "-e", GHOSTTY_OPEN_APPLESCRIPT, "-o", join(dir, "ghostty-open.scpt")],
        { stdout: "pipe", stderr: "pipe" },
      );

      expect(compiled.stderr.toString()).toBe("");
      expect(compiled.exitCode).toBe(0);
    },
  );

  test("requires the documented 1.3 API", () => {
    expect(supportsGhosttyAppleScript("1.2.3")).toBe(false);
    expect(supportsGhosttyAppleScript("1.3.0")).toBe(true);
    expect(supportsGhosttyAppleScript("1.3.1")).toBe(true);
    expect(supportsGhosttyAppleScript(null)).toBe(false);
  });

  test("detects Ghostty's own environment, not TERM alone", () => {
    expect(insideGhostty({ TERM_PROGRAM: "ghostty" })).toBe(true);
    expect(insideGhostty({ GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app" })).toBe(true);
    expect(insideGhostty({ TERM_PROGRAM: "other" })).toBe(false);
  });
});

describe("openGhosttyThreadSurface", () => {
  test.each(["tab", "pane", "window"] as const)("opens a focused %s", async (mode) => {
    const native = stub(`open-${mode}`);
    const store = persistence();

    expect(
      await openGhosttyThreadSurface(
        thread(),
        store.port,
        { TERM_PROGRAM: "ghostty" },
        mode,
        native.binPath,
        "darwin",
      ),
    ).toBe("opened");
    expect(store.saved()).toEqual({ terminalId: "term-1" });
    expect(log(native.logPath)).toEqual([
      "version",
      `open:${mode}:cueloop ses_ghostty1:/repo/work`,
    ]);
    const script = readFileSync(native.scriptPath, "utf8");

    expect(script).toContain("set command of cfg to threadCommand");
    expect(script).toContain("set targetWindow to front window");
    expect(script).toContain("split sourceTerminal direction right with configuration cfg");
    expect(script).toContain('perform action "new_tab" on sourceTerminal');
    expect(script).toContain("focus createdTerminal");
    expect(readFileSync(native.shellPath, "utf8").trim()).toBe(
      "cd -- '/repo/work' && cueloop 'ses_ghostty1'",
    );
  });

  test("focuses a live terminal without creating another", async () => {
    const native = stub("focus");
    const store = persistence({ terminalId: "ses_previous" });

    expect(
      await openGhosttyThreadSurface(
        thread(),
        store.port,
        { TERM_PROGRAM: "ghostty" },
        "tab",
        native.binPath,
        "darwin",
      ),
    ).toBe("focused");
    expect(log(native.logPath)).toEqual(["version", "focus:ses_previous"]);
  });

  test("quotes a workspace path before entering it in a Ghostty shell", async () => {
    const native = stub("quoted-cwd");
    const reviewed = thread();

    reviewed.artifact.meta.cwd = "/repo/it's $(unsafe)";
    expect(
      await openGhosttyThreadSurface(
        reviewed,
        persistence().port,
        { TERM_PROGRAM: "ghostty" },
        "tab",
        native.binPath,
        "darwin",
      ),
    ).toBe("opened");
    expect(readFileSync(native.shellPath, "utf8").trim()).toBe(
      "cd -- '/repo/it'\\''s $(unsafe)' && cueloop 'ses_ghostty1'",
    );
  });

  test("reopens a closed terminal and replaces its handle", async () => {
    const native = stub("closed", "closed");
    const store = persistence({ terminalId: "ses_previous" });

    expect(
      await openGhosttyThreadSurface(
        thread(),
        store.port,
        { TERM_PROGRAM: "ghostty" },
        "pane",
        native.binPath,
        "darwin",
      ),
    ).toBe("opened");
    expect(store.saved()).toEqual({ terminalId: "term-1" });
    expect(log(native.logPath)).toEqual([
      "version",
      "focus:ses_previous",
      "open:pane:cueloop ses_ghostty1:/repo/work",
    ]);
  });

  test("missing capability, denied automation, and disabled placement never resolve a Thread", async () => {
    const old = stub("old", "focused", "1.2.3");
    const denied = stub("denied", "focused", "1.3.1", true);
    const store = persistence();
    const env = { TERM_PROGRAM: "ghostty" };

    expect(
      await openGhosttyThreadSurface(thread(), store.port, env, "tab", old.binPath, "darwin"),
    ).toBe("failed");
    expect(
      await openGhosttyThreadSurface(thread(), store.port, env, "tab", denied.binPath, "darwin"),
    ).toBe("failed");
    expect(
      await openGhosttyThreadSurface(thread(), store.port, env, "none", denied.binPath, "darwin"),
    ).toBe("disabled");
    expect(
      await openGhosttyThreadSurface(thread(), store.port, {}, "tab", denied.binPath, "darwin"),
    ).toBe("unavailable");
    expect(store.saved()).toBeNull();
  });
});
