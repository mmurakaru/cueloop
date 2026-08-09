/**
 * PTY tests: the real `cueloop` TUI binary in a pseudo-terminal, asserting
 * what the virtual-terminal tier cannot prove - alternate-screen render, key
 * routing through a raw tty, SIGWINCH resize, and the process exit code.
 * bun-pty is the backend because node-pty's native spawn silently kills the
 * Bun process on macOS arm64. Env-gated behind CUELOOP_RUN_PTY (`bun run
 * test:pty`). The tests share one PTY session and run in file order; OpenTUI
 * repaints only changed cells, so assertions read the stripped output delta.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type IPty } from "bun-pty";
import { DaemonServer } from "@cueloop/daemon";

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
  if (!predicate()) throw new Error(`timed out waiting for ${what}; buffer: ${JSON.stringify(stripAnsi(ptyOutput).slice(-500))}`);
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
  pty = spawn(process.execPath, ["run", CLI, sessionId], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: ROOT,
    env: { ...process.env, CUELOOP_HOME: home } as Record<string, string>,
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
  ptyTest("initial render paints the plan in a real terminal", async () => {
    await waitFor(() => stripAnsi(ptyOutput).includes("Rollout Plan"), 20_000, "the plan title");
    await waitFor(() => stripAnsi(ptyOutput).includes("Enable it for everyone immediately."), 20_000, "the plan body");
    const frame = stripAnsi(ptyOutput);
    expect(frame).toContain("Rollout Plan");
    expect(frame).toContain("Ship the daemon behind a flag.");
    // the cursor glyph starts on the title block
    expect(frame).toMatch(/▎ +Rollout Plan/);
  }, 30_000);

  ptyTest("j routes through the raw tty: the cursor glyph moves block by block", async () => {
    ptyOutput = "";
    pty.write("j");
    // the cell-diff repaint after j redraws the newly highlighted block behind the glyph
    await waitFor(() => /▎ +Phase 1/.test(stripAnsi(ptyOutput)), 10_000, "cursor on Phase 1");
    ptyOutput = "";
    pty.write("j");
    await waitFor(() => /▎ +Ship the daemon behind a flag\./.test(stripAnsi(ptyOutput)), 10_000, "cursor on the paragraph");
  }, 30_000);

  ptyTest("resize does not crash and forces a repaint", async () => {
    ptyOutput = "";
    pty.resize(100, 24);
    await waitFor(() => ptyOutput.length > 0, 10_000, "a repaint after resize");
    expect(exit).toBeNull();
    // grow back; the TUI keeps repainting rather than dying on SIGWINCH
    ptyOutput = "";
    pty.resize(120, 30);
    await waitFor(() => ptyOutput.length > 0, 10_000, "a repaint after growing back");
    expect(exit).toBeNull();
    // the cursor position survives both resizes
    await waitFor(() => /▎ +Ship the daemon behind a flag\./.test(stripAnsi(ptyOutput)), 10_000, "cursor after resize");
  }, 30_000);

  ptyTest("q exits cleanly with code 0", async () => {
    pty.write("q");
    await waitFor(() => exit !== null, 10_000, "process exit");
    expect(exit!.exitCode).toBe(0);
  }, 30_000);
});
