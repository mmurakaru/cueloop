/**
 * PTY tests: the real `cueloop` TUI binary in a pseudo-terminal, asserting
 * what the virtual-terminal tier cannot prove - alternate-screen render, key
 * routing through a raw tty, SIGWINCH resize, and the process exit code.
 * The backend is cueloop's own forkpty FFI shim (packages/client/src/pty.ts).
 * Env-gated behind CUELOOP_RUN_PTY (`bun run
 * test:pty`). The tests share one PTY session and run in file order; OpenTUI
 * repaints only changed cells, so assertions read the stripped output delta.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type IPty } from "../../packages/client/src/pty";
import { DaemonServer } from "@cueloop/daemon";
import { HERMETIC_HERDR_ENV } from "../helpers/env";

const RUN = !!process.env.CUELOOP_RUN_PTY;
const ptyTest = RUN ? test : test.skip;

const ROOT = join(import.meta.dir, "..", "..");
const CLI = join(ROOT, "packages", "cli", "src", "main.ts");

const PLAN = `# Rollout Plan

## Phase 1

Ship the daemon behind a flag.

## Phase 2

Enable it for everyone immediately.
`;

/** CSI (incl. private params), OSC, DCS/APC-style strings, and bare ESC finals. */
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\[[0-9;?>=<]*[ -/]*[@-~]|\][^]*(?:|\\)|P[^]*\\|[@-Z\\-_]/g;

function stripAnsi(raw: string): string {
  return raw.replace(ANSI, "");
}

let home: string;
let server: DaemonServer;
let sessionId: string;
let pty: IPty;
let ptyOutput = "";
let exit: { exitCode: number } | null = null;

/** PTY output arrives in chunks; poll a predicate against the buffer with a deadline. */
async function waitFor(predicate: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(50);
  }
  if (!predicate())
    throw new Error(
      `timed out waiting for ${what}; buffer: ${JSON.stringify(stripAnsi(ptyOutput).slice(-500))}`,
    );
}

beforeAll(async () => {
  if (!RUN) return;
  home = mkdtempSync(join(tmpdir(), "cueloop-pty-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  const session = server.core.sessionCreate({
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: PLAN, meta: { title: "Rollout Plan", planPath: "plan.md" } },
  });

  sessionId = session.id;
  // A non-interactive editor that appends a marker, so the e hand-off proves
  // the renderer suspends, spawns on the real tty, and resumes.
  const editorScript = join(home, "pty-editor.sh");

  writeFileSync(editorScript, `#!/bin/sh\nprintf '\\n\\nEdited via PTY hand-off.\\n' >> "$1"\n`);
  chmodSync(editorScript, 0o755);
  const environment: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value;
  }
  Object.assign(environment, HERMETIC_HERDR_ENV);
  environment.CUELOOP_HOME = home;
  environment.CUELOOP_EDITOR = editorScript;
  pty = spawn(process.execPath, ["run", CLI, sessionId], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: ROOT,
    env: environment,
  });
  pty.onData((chunk) => {
    ptyOutput += chunk;
  });
  pty.onExit((exitEvent) => {
    exit = exitEvent;
  });
});

afterAll(() => {
  if (!RUN) return;
  if (exit === null) {
    try {
      pty.kill();
    } catch {
      // already gone
    }
  }
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("PTY tier: the real TUI in a pseudo-terminal", () => {
  ptyTest(
    "initial render paints the plan in a real terminal",
    async () => {
      await waitFor(() => stripAnsi(ptyOutput).includes("Rollout Plan"), 20_000, "the plan title");
      await waitFor(
        () => stripAnsi(ptyOutput).includes("Enable it for everyone immediately."),
        20_000,
        "the plan body",
      );
      const frame = stripAnsi(ptyOutput);

      expect(frame).toContain("Rollout Plan");
      expect(frame).toContain("Ship the daemon behind a flag.");
      // the rail and its submit button frame the thread
      expect(frame).toContain("Submit review");
    },
    60_000,
  );

  ptyTest(
    "keys route through the raw tty: arrows move the caret, a printable opens a draft there",
    async () => {
      // Arrange
      ptyOutput = "";

      // Act: two blocks down lands the caret on the first paragraph; typing
      // opens a draft card under it, which repaints through the raw tty
      pty.write("\x1b[B");
      pty.write("\x1b[B");
      pty.write("x");

      // Assert
      await waitFor(() => stripAnsi(ptyOutput).includes("● x"), 10_000, "the draft card");

      // Act: escape twice drops the draft, then the mark
      ptyOutput = "";
      pty.write("\x1b");
      await Bun.sleep(300);
      pty.write("\x1b");
      await Bun.sleep(300);

      // Assert
      expect(exit).toBeNull();
    },
    60_000,
  );

  ptyTest(
    "resize does not crash and forces a repaint",
    async () => {
      // Arrange
      ptyOutput = "";

      // Act
      pty.resize(100, 24);

      // Assert
      await waitFor(() => ptyOutput.length > 0, 10_000, "a repaint after resize");
      expect(exit).toBeNull();

      // Act
      // grow back; the TUI keeps repainting rather than dying on SIGWINCH
      ptyOutput = "";
      pty.resize(120, 30);

      // Assert
      await waitFor(() => ptyOutput.length > 0, 10_000, "a repaint after growing back");
      expect(exit).toBeNull();
      // the document survives both resizes
      await waitFor(
        () => stripAnsi(ptyOutput).includes("Ship the daemon behind a flag."),
        10_000,
        "the paragraph after resize",
      );
    },
    60_000,
  );

  ptyTest(
    "ctrl+e suspends the renderer, runs the editor on the real tty, and resumes with the edit",
    async () => {
      // Arrange
      ptyOutput = "";

      // Act
      pty.write("\x05");

      // Assert
      // resume repaints the plan with the appended line - proof the full
      // suspend -> spawn -> resume cycle ran without crashing the tty
      await waitFor(
        () => stripAnsi(ptyOutput).includes("Edited via PTY hand-off."),
        15_000,
        "the edited plan after resume",
      );
      expect(exit).toBeNull();

      // Act
      // the TUI is live again: an arrow still routes through the raw tty
      ptyOutput = "";
      pty.write("\x1b[B");

      // Assert
      await waitFor(() => ptyOutput.length > 0, 10_000, "a repaint after resume");
      expect(exit).toBeNull();
    },
    60_000,
  );

  ptyTest(
    "ctrl+q exits cleanly with code 0",
    async () => {
      // Act
      pty.write("\x11");

      // Assert
      await waitFor(() => exit !== null, 10_000, "process exit");
      expect(exit!.exitCode).toBe(0);
    },
    60_000,
  );
});
