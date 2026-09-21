import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "@cueloop/schema";
import {
  insideGhostty,
  openGhosttyThreadSurface as openActualGhosttyThreadSurface,
  resolveCueloopLaunchCommand,
  supportsGhosttyAppleScript,
  GHOSTTY_OPEN_APPLESCRIPT,
  type GhosttyThreadSurfacePersistence,
} from "./ghostty-thread-surface";
import type { GhosttyThreadSurfaceHandle } from "./ghostty-thread-surface-store";

const dir = mkdtempSync(join(tmpdir(), "cueloop-ghostty-thread-surface-"));
const openGhosttyThreadSurface: typeof openActualGhosttyThreadSurface = (
  reviewed,
  persistence,
  env,
  mode,
  binPath,
  platform,
) =>
  openActualGhosttyThreadSurface(
    reviewed,
    persistence,
    env,
    mode,
    binPath,
    platform,
    "/usr/local/bin/cueloop",
  );

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
  let claimed = false;
  const port: GhosttyThreadSurfacePersistence = {
    ghosttyClaimThreadSurface: async () => {
      if (claimed) return false;
      claimed = true;

      return true;
    },
    ghosttyReleaseThreadSurface: async () => {
      claimed = false;
    },
    ghosttyGetThreadSurface: async () => saved,
    ghosttySetThreadSurface: async (_id, handle) => {
      saved = handle;
    },
  };

  return { port, saved: () => saved };
}

function stub(
  name: string,
  focusResult = "focused",
  version = "1.3.1",
  openFails = false,
  closeFails = false,
) {
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
case "$2" in
  *"close candidate"*)
    printf 'close:%s\\n' "$3" >> "${logPath}"
    ${closeFails ? "exit 1" : ""}
    printf 'closed\\n'
    exit 0
    ;;
esac
if [ "$3" = "ses_previous" ] || [ "$3" = "term-1" ]; then
  printf 'focus:%s\\n' "$3" >> "${logPath}"
  printf '${focusResult}\\n'
  exit 0
fi
printf 'open:%s:%s\\n' "$3" "$4" >> "${logPath}"
printf '%s\\n' "$5" > "${shellPath}"
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

  test("source CLI invocation uses its absolute entry when no cueloop binary is installed", () => {
    const entry = join(import.meta.dir, "../../cli/src/main.ts");

    expect(resolveCueloopLaunchCommand(process.execPath, entry, "")).toBe(
      `'${process.execPath}' run '${entry}'`,
    );
    expect(resolveCueloopLaunchCommand(process.execPath, "/other", "")).toBeNull();
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
    expect(log(native.logPath)).toEqual(["version", `open:${mode}:/repo/work`]);
    const script = readFileSync(native.scriptPath, "utf8");

    expect(script).toContain(
      "set initial working directory of surfaceConfiguration to threadDirectory",
    );
    expect(script).toContain("input text shellCommand to createdTerminal");
    expect(script).toContain("set targetWindow to front window");
    expect(script).toContain(
      "split sourceTerminal direction right with configuration surfaceConfiguration",
    );
    expect(script).toContain('perform action "new_tab" on sourceTerminal');
    expect(script).toContain("focus createdTerminal");
    expect(readFileSync(native.shellPath, "utf8").trim()).toBe(
      "cd -- '/repo/work' && '/usr/local/bin/cueloop' 'ses_ghostty1'",
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

  test("focuses a live terminal even if cueloop is no longer on PATH", async () => {
    const native = stub("focus-no-binary");
    const store = persistence({ terminalId: "ses_previous" });

    expect(
      await openActualGhosttyThreadSurface(
        thread(),
        store.port,
        { TERM_PROGRAM: "ghostty" },
        "tab",
        native.binPath,
        "darwin",
        null,
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
      "cd -- '/repo/it'\\''s $(unsafe)' && '/usr/local/bin/cueloop' 'ses_ghostty1'",
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
    expect(log(native.logPath)).toEqual(["version", "focus:ses_previous", "open:pane:/repo/work"]);
  });

  test("closes an untracked terminal when daemon persistence fails", async () => {
    const native = stub("persist-failed");
    const store: GhosttyThreadSurfacePersistence = {
      ghosttyClaimThreadSurface: async () => true,
      ghosttyReleaseThreadSurface: async () => {},
      ghosttyGetThreadSurface: async () => null,
      ghosttySetThreadSurface: async () => {
        throw new Error("daemon unavailable");
      },
    };

    expect(
      await openGhosttyThreadSurface(
        thread(),
        store,
        { TERM_PROGRAM: "ghostty" },
        "tab",
        native.binPath,
        "darwin",
      ),
    ).toBe("failed");
    expect(log(native.logPath)).toEqual(["version", "open:tab:/repo/work", "close:term-1"]);
  });

  test("does not open another tab when native identity lookup fails", async () => {
    const native = stub("lookup-failed");
    const store: GhosttyThreadSurfacePersistence = {
      ghosttyClaimThreadSurface: async () => true,
      ghosttyReleaseThreadSurface: async () => {},
      ghosttyGetThreadSurface: async () => {
        throw new Error("daemon unavailable");
      },
      ghosttySetThreadSurface: async () => {},
    };

    expect(
      await openGhosttyThreadSurface(
        thread(),
        store,
        { TERM_PROGRAM: "ghostty" },
        "tab",
        native.binPath,
        "darwin",
      ),
    ).toBe("failed");
    expect(log(native.logPath)).toEqual(["version"]);
  });

  test("retains the claim if an untracked native terminal cannot be closed", async () => {
    const native = stub("close-failed", "focused", "1.3.1", false, true);
    let claimed = false;
    const store: GhosttyThreadSurfacePersistence = {
      ghosttyClaimThreadSurface: async () => {
        if (claimed) return false;
        claimed = true;

        return true;
      },
      ghosttyReleaseThreadSurface: async () => {
        claimed = false;
      },
      ghosttyGetThreadSurface: async () => null,
      ghosttySetThreadSurface: async () => {
        throw new Error("daemon write failed");
      },
    };
    const launch = () =>
      openGhosttyThreadSurface(
        thread(),
        store,
        { TERM_PROGRAM: "ghostty" },
        "tab",
        native.binPath,
        "darwin",
      );

    expect(await launch()).toBe("failed");
    expect(await launch()).toBe("failed");
    expect(log(native.logPath).filter((line) => line.startsWith("open:"))).toEqual([
      "open:tab:/repo/work",
    ]);
  });

  test("concurrent callers cannot open duplicate live surfaces", async () => {
    const native = stub("concurrent");
    const store = persistence();
    const launch = () =>
      openGhosttyThreadSurface(
        thread(),
        store.port,
        { TERM_PROGRAM: "ghostty" },
        "tab",
        native.binPath,
        "darwin",
      );

    expect((await Promise.all([launch(), launch()])).toSorted()).toEqual(["failed", "opened"]);
    expect(log(native.logPath).filter((line) => line.startsWith("open:"))).toEqual([
      "open:tab:/repo/work",
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
    expect(
      await openActualGhosttyThreadSurface(
        thread(),
        store.port,
        env,
        "tab",
        denied.binPath,
        "darwin",
        null,
      ),
    ).toBe("failed");
    expect(store.saved()).toBeNull();
  });
});
