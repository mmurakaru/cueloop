/**
 * PTY test session: the real TUI running in a pseudo terminal, with its output
 * fed into an in-process Ghostty VT emulator so tests read the rendered screen
 * grid instead of raw escape bytes. OpenTUI repaints only changed cells, so the
 * byte stream is never "the screen" - the emulator is. Tests press named keys,
 * wait on screen predicates, and get the last screen in every timeout error.
 * Readiness comes from the app's own signal (`waitForReady`), never from
 * output silence. Wait helpers take a `PtyScreenReader` so they are
 * unit-testable with a fake.
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadGhosttyTerminals,
  type GhosttyCell,
  type GhosttyTerminal,
} from "../../packages/client/src/ghostty-terminal";
import { ptyAvailable, spawn, type ExitEvent, type IPty } from "../../packages/client/src/pty";
import { READY_FILE_ENV } from "../../packages/client/src/ready-signal";
import { locateTextInFrame, type FrameLocation } from "../../packages/client/src/test-support";
import { hermeticCueloopEnvironment } from "./env";
import { encodePtyKeyPress, type PtyKeyPress } from "./pty-key-codes";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "packages", "cli", "src", "main.ts");

/** Default terminal size; wide enough for the three-pane shell, short enough to reach scrolling. */
const DEFAULT_COLS = 140;
const DEFAULT_ROWS = 24;

/** Output must stay quiet this long before `waitIdle` counts a frame as painted. */
const IDLE_QUIET_MS = 60;
/** `waitIdle` gives up waiting for quiet after this long; a frame that keeps changing is not a failure. */
const IDLE_TIMEOUT_MS = 500;
/** Default deadline for screen predicates after an interaction. */
const SCREEN_WAIT_TIMEOUT_MS = 5_000;
/** Gap between polls while a condition is pending. */
const POLL_MS = 30;
/**
 * Gap between characters in `type`: a human typing rate. The composer reorders
 * characters that arrive faster than about 30 ms apart (issue #365); the tier
 * types like a person until that is fixed.
 */
const TYPE_CHARACTER_GAP_MS = 30;
/** How long `close` waits for SIGTERM to work before escalating to SIGKILL. */
const TERMINATE_GRACE_MS = 2_000;
/** Deadline for the app's ready signal: the CLI boots through bun and the daemon socket. */
const READY_TIMEOUT_MS = 20_000;

/** What the wait helpers need from a session: the screen and the exit state. */
export interface PtyScreenReader {
  /** The rendered screen as right-trimmed rows joined by newline. */
  text(): string;
  /** The child's exit record, or null while it runs. */
  exit(): ExitEvent | null;
}

export interface PtyScreenWaitOptions {
  timeoutMs?: number;
  /** Named in the timeout error so a red run says what the test waited for. */
  what?: string;
}

/** Poll `condition` every POLL_MS until it holds or the deadline passes; true when it held. */
async function pollUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() >= deadline) return false;
    await Bun.sleep(POLL_MS);
  }

  return true;
}

/**
 * Poll the screen until `predicate` accepts it. Throws with the full last
 * screen on timeout, and early when the child exits first. Never re-sends
 * input: a dropped key must stay a test failure, not get papered over.
 */
export async function waitForPtyScreen(
  reader: PtyScreenReader,
  predicate: (screen: string) => boolean,
  options: PtyScreenWaitOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? SCREEN_WAIT_TIMEOUT_MS;
  const what = options.what ?? "the screen predicate";
  let screen = reader.text();
  const settled = await pollUntil(() => {
    if (predicate(screen)) return true;
    if (reader.exit() !== null) return true;
    screen = reader.text();

    return predicate(screen);
  }, timeoutMs);

  if (predicate(screen)) return screen;
  const exit = reader.exit();

  if (settled && exit !== null) {
    throw new Error(
      `PTY child exited with code ${exit.exitCode} before ${what}. Last screen:\n${screen}`,
    );
  }

  throw new Error(
    `PTY screen wait timed out after ${timeoutMs}ms waiting for ${what}. Last screen:\n${screen}`,
  );
}

/** Wait until the screen contains `pattern` (a substring or a regular expression). */
export function waitForPtyText(
  reader: PtyScreenReader,
  pattern: string | RegExp,
  options: PtyScreenWaitOptions = {},
): Promise<string> {
  const matches =
    pattern instanceof RegExp
      ? (screen: string) => {
          // a global or sticky pattern remembers lastIndex between calls
          pattern.lastIndex = 0;

          return pattern.test(screen);
        }
      : (screen: string) => screen.includes(pattern);

  return waitForPtyScreen(reader, matches, { what: `text ${String(pattern)}`, ...options });
}

export interface LaunchTuiSessionOptions {
  /** The isolated CUELOOP_HOME whose daemon owns the session under review. */
  home: string;
  /** CLI arguments, typically the session id to open. */
  args: string[];
  cols?: number;
  rows?: number;
  /** Per-test overrides applied last; set TERM=dumb or NO_COLOR here. */
  env?: Record<string, string>;
}

/** True when this platform ships both native shims the PTY tier needs (pty and Ghostty VT). */
export function ptyTuiAvailable(): boolean {
  return ptyAvailable() && loadGhosttyTerminals() !== null;
}

/**
 * Spawn the TUI in a fresh PTY. Runs the CLI source through bun unless
 * CUELOOP_TEST_EXECUTABLE names a compiled binary, so the same suite proves
 * both the tree and the shipped artifact.
 */
export function launchTuiSession(options: LaunchTuiSessionOptions): PtyTuiSession {
  const factory = loadGhosttyTerminals();

  if (factory === null) {
    throw new Error("PTY session launch failed: no Ghostty VT shim for this platform");
  }
  const cols = options.cols ?? DEFAULT_COLS;
  const rows = options.rows ?? DEFAULT_ROWS;
  const terminal = factory.create(cols, rows);

  if (terminal === null) {
    throw new Error("PTY session launch failed: Ghostty terminal allocation failed");
  }
  const readyFile = join(options.home, `ready-${++launchCount}`);
  const environment = hermeticCueloopEnvironment(options.home, {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PATH: `${offlineBinDirectory(options.home)}:${process.env.PATH ?? ""}`,
    [READY_FILE_ENV]: readyFile,
    ...options.env,
  });
  const executable = process.env.CUELOOP_TEST_EXECUTABLE;
  const command = executable ?? process.execPath;
  const args = executable ? options.args : ["run", CLI_ENTRY, ...options.args];
  const pty = spawn(command, args, {
    name: environment.TERM,
    cols,
    rows,
    cwd: REPO_ROOT,
    env: environment,
  });

  return new PtyTuiSession(pty, terminal, readyFile);
}

/** Distinguishes the ready files of sessions launched from one home. */
let launchCount = 0;

/**
 * A bin directory whose `ssh` fails at once with a recognizable message, put
 * first on the child's PATH so a share chord can never reach the live gateway
 * from a test. Created once per home.
 */
function offlineBinDirectory(home: string): string {
  const directory = join(home, "offline-bin");
  const ssh = join(directory, "ssh");

  if (!existsSync(ssh)) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(ssh, `#!/bin/sh\necho "${OFFLINE_SSH_MESSAGE}" >&2\nexit 255\n`);
    chmodSync(ssh, 0o755);
  }

  return directory;
}

/** What the stub `ssh` prints to stderr; share failure toasts quote it. */
export const OFFLINE_SSH_MESSAGE = "test: network disabled";

/** A live TUI in a PTY with a Ghostty screen behind it. Always `close()` it in `afterAll`. */
export class PtyTuiSession implements PtyScreenReader {
  private readonly encoder = new TextEncoder();
  /** Bumped on every PTY chunk and resize; screen reads are cached against it so idle polls cost no FFI. */
  private generation = 0;
  private lastDataAt = 0;
  private exitRecord: ExitEvent | null = null;
  private textCache: { generation: number; text: string } | null = null;

  constructor(
    private readonly pty: IPty,
    private readonly terminal: GhosttyTerminal,
    private readonly readyFile: string,
  ) {
    pty.onData((chunk) => {
      this.terminal.write(this.encoder.encode(chunk));
      this.generation += 1;
      this.lastDataAt = Date.now();
    });
    pty.onExit((event) => {
      this.exitRecord = event;
    });
  }

  exit(): ExitEvent | null {
    return this.exitRecord;
  }

  /** The screen as text: one right-trimmed string per row. */
  text(): string {
    if (this.textCache?.generation === this.generation) return this.textCache.text;
    const lines: string[] = [];

    for (let y = 0; y < this.pty.rows; y++) lines.push(this.terminal.rowText(y, this.pty.cols));
    this.textCache = { generation: this.generation, text: lines.join("\n") };

    return this.textCache.text;
  }

  /** Every cell of one row with its colors and attributes, for gutter and highlight assertions. */
  cells(row: number): (GhosttyCell | null)[] {
    const cells: (GhosttyCell | null)[] = [];

    for (let x = 0; x < this.pty.cols; x++) cells.push(this.terminal.readCell(x, row));

    return cells;
  }

  /** Write bytes straight to the child's tty; for sequences the key table cannot express. */
  writeRaw(data: string): void {
    this.pty.write(data);
  }

  /** Press one key or chord by name and wait for its repaint to go quiet. */
  async press(key: PtyKeyPress): Promise<void> {
    await this.writeAndSettle(encodePtyKeyPress(key));
  }

  /** Type text one character at a time (`gapMs` apart), then wait for the repaint to go quiet. */
  async type(text: string, gapMs = TYPE_CHARACTER_GAP_MS): Promise<void> {
    const before = this.generation;

    for (const character of text) {
      this.pty.write(character);
      await Bun.sleep(gapMs);
    }
    await this.settleAfterInput(before);
  }

  /** The 0-based position of the first on-screen occurrence of `needle`; throws with the screen when absent. */
  locate(needle: string): FrameLocation {
    const screen = this.text();
    const location = locateTextInFrame(screen, needle);

    if (location === null) {
      throw new Error(`PTY text "${needle}" is not on screen:\n${screen}`);
    }

    return location;
  }

  /** Left-click the first on-screen occurrence of `needle` (SGR 1006 mouse encoding). */
  async click(needle: string): Promise<void> {
    const location = this.locate(needle);

    await this.clickAt(location.column, location.row);
  }

  /** Left-click a 0-based cell. */
  async clickAt(column: number, row: number): Promise<void> {
    const x = column + 1;
    const y = row + 1;

    await this.writeAndSettle(`\x1b[<0;${x};${y}M\x1b[<0;${x};${y}m`);
  }

  /** Resize the emulator and the child's tty together, which delivers SIGWINCH. */
  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
    this.pty.resize(cols, rows);
    this.generation += 1;
  }

  /**
   * Write input, then wait for the output it causes to arrive and go quiet.
   * Output is asynchronous, so a bare quiet check right after the write would
   * pass on the silence that preceded the key; the wait first requires a chunk
   * newer than the write, bounded so a key with no visible effect still returns.
   */
  private async writeAndSettle(data: string): Promise<void> {
    const before = this.generation;

    this.pty.write(data);
    await this.settleAfterInput(before);
  }

  private async settleAfterInput(generationBefore: number): Promise<void> {
    const deadline = Date.now() + IDLE_TIMEOUT_MS;

    await pollUntil(
      () => this.generation !== generationBefore || this.exitRecord !== null,
      IDLE_TIMEOUT_MS,
    );
    await this.waitIdle(IDLE_QUIET_MS, Math.max(IDLE_QUIET_MS, deadline - Date.now()));
  }

  /** Resolve once output has been quiet for `quietMs`, or after a bounded timeout. */
  async waitIdle(quietMs = IDLE_QUIET_MS, timeoutMs = IDLE_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (this.exitRecord === null && Date.now() < deadline) {
      const quietFor = Date.now() - this.lastDataAt;

      if (quietFor >= quietMs) return;
      await Bun.sleep(Math.min(quietMs - quietFor, deadline - Date.now()));
    }
  }

  waitForText(pattern: string | RegExp, options?: PtyScreenWaitOptions): Promise<string> {
    return waitForPtyText(this, pattern, options);
  }

  waitForScreen(
    predicate: (screen: string) => boolean,
    options?: PtyScreenWaitOptions,
  ): Promise<string> {
    return waitForPtyScreen(this, predicate, options);
  }

  /**
   * Press once, then wait for `predicate`. The predicate must tell the
   * destination apart from the screen before the key, or it passes vacuously.
   */
  async pressAndWaitForScreen(
    key: PtyKeyPress,
    predicate: (screen: string) => boolean,
    options?: PtyScreenWaitOptions,
  ): Promise<string> {
    await this.press(key);

    return waitForPtyScreen(this, predicate, options);
  }

  /** Wait for the child to exit; throws with the screen when it is still alive at the deadline. */
  async waitForExit(timeoutMs = SCREEN_WAIT_TIMEOUT_MS): Promise<ExitEvent> {
    await pollUntil(() => this.exitRecord !== null, timeoutMs);
    if (this.exitRecord === null) {
      throw new Error(`PTY child still running after ${timeoutMs}ms. Last screen:\n${this.text()}`);
    }

    return this.exitRecord;
  }

  /**
   * Wait for the app's ready signal: the file it writes after the first frame
   * that paints a usable screen, by which point every keyboard handler is
   * subscribed (see packages/client/src/ready-signal.ts).
   */
  async waitForReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
    await waitForPtyScreen(this, () => existsSync(this.readyFile), {
      timeoutMs,
      what: "the ready signal",
    });
  }

  /**
   * Stop the child and free the emulator. SIGTERM goes to the whole process
   * group (the PTY child is a session leader, so its pid is the pgid), then
   * SIGKILL after a grace period; the read loop reports the real exit code.
   * The shim's own kill is the last resort and synthesizes exit code 0.
   */
  async close(): Promise<ExitEvent> {
    if (this.exitRecord === null) {
      this.signalProcessGroup("SIGTERM");
      await pollUntil(() => this.exitRecord !== null, TERMINATE_GRACE_MS);
    }
    if (this.exitRecord === null) {
      this.signalProcessGroup("SIGKILL");
      await pollUntil(() => this.exitRecord !== null, TERMINATE_GRACE_MS);
    }
    if (this.exitRecord === null) this.pty.kill();
    this.terminal.free();

    return this.exitRecord ?? { exitCode: 0 };
  }

  private signalProcessGroup(signal: "SIGTERM" | "SIGKILL"): void {
    try {
      process.kill(-this.pty.pid, signal);
    } catch {
      // the group is already gone; the read loop reports the exit
    }
  }
}
