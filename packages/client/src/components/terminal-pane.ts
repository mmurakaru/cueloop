/**
 * An OpenTUI renderable that runs a real child process (a shell, cc, pi, codex)
 * on a PTY and paints its live screen into the box - the terminal-in-the-rail
 * primitive. It wires the forkpty shim (child + tty, ../pty) to a Ghostty VT emulator
 * (ghostty-terminal.ts) and blits the emulator's cell grid every frame via
 * OptimizedBuffer.setCell. Register once with `registerTerminalPane`, then use
 * `<terminalPane command="claude" ... />` in the OpenTUI React tree.
 */

import { Renderable, RGBA, createTextAttributes, type RenderContext } from "@opentui/core";
import type { OptimizedBuffer } from "@opentui/core";
import type { RenderableOptions } from "@opentui/core";
import { extend } from "@opentui/react";
import { spawn, ptyAvailable, type IPty } from "../pty";
import {
  loadGhosttyTerminals,
  type GhosttyColor,
  type GhosttyTerminal,
  type GhosttyTerminalFactory,
} from "../ghostty-terminal";

/** One shared VT library load; null when this platform ships no prebuilt dylib. */
let ghosttyFactory: GhosttyTerminalFactory | null | undefined;
function factory(): GhosttyTerminalFactory | null {
  if (ghosttyFactory === undefined) ghosttyFactory = loadGhosttyTerminals();
  return ghosttyFactory;
}

/** Whether the embedded terminal can run here: both native shims ship for this
 *  platform (the Ghostty VT renderer and the forkpty PTY). */
export function embeddedTerminalAvailable(): boolean {
  return factory() !== null && ptyAvailable();
}

/** Props for `<terminalPane>`: the child to run plus its cwd/env and a plan-context seed. */
export interface TerminalPaneOptions extends RenderableOptions {
  /** The program to run, e.g. "claude" / "pi" / "codex" / a shell. */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Text left unsubmitted in the child after it starts (plan-context seed). */
  seedText?: string;
  /** Fired when the child process exits. */
  onExit?: (exitCode: number) => void;
}

const encoder = new TextEncoder();
const DEFAULT_FG = RGBA.fromInts(208, 208, 208, 255);
const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0);
/** Glyph color under the block cursor (dark ink on the light cursor block). */
const CURSOR_INK = RGBA.fromInts(20, 20, 24, 255);

/** Runs a PTY child and paints its Ghostty-rendered screen into this box. */
export class TerminalPaneRenderable extends Renderable {
  private pty: IPty | null = null;
  private vt: GhosttyTerminal | null = null;
  private cols = 0;
  private rows = 0;
  // The seed is held until the child's first output, so it lands in a ready
  // prompt rather than racing the harness's startup (readline/TUI not up yet).
  private pendingSeed: string | undefined;
  private readonly opts: TerminalPaneOptions;

  constructor(ctx: RenderContext, options: TerminalPaneOptions) {
    super(ctx, options);
    this.opts = options;
    this.focusable = true;
  }

  /** Start the child + emulator once real layout dimensions are known. */
  private start(cols: number, rows: number): void {
    const terminals = factory();
    if (!terminals) return;
    const vt = terminals.create(cols, rows);
    if (!vt) return; // no emulator, no visible screen - do not spawn a blind child
    this.vt = vt;
    this.cols = cols;
    this.rows = rows;
    this.pendingSeed = this.opts.seedText;
    this.pty = spawn(this.opts.command ?? process.env.SHELL ?? "/bin/sh", this.opts.args ?? [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: this.opts.cwd ?? process.cwd(),
      env: (this.opts.env ?? process.env) as Record<string, string>,
    });
    this.pty.onData((data) => {
      // the shim streams a UTF-8-decoded string (split multibyte is handled); a
      // rare non-UTF-8 byte arrives as U+FFFD - acceptable for agent TUIs.
      this.vt?.write(encoder.encode(data));
      if (this.pendingSeed !== undefined) {
        this.pty?.write(this.pendingSeed);
        this.pendingSeed = undefined;
      }
      this.requestRender();
    });
    this.pty.onExit(({ exitCode }) => this.opts.onExit?.(exitCode));
  }

  /** Send raw bytes to the child (a key's escape sequence, or pasted text). */
  write(data: string): void {
    this.pty?.write(data);
  }

  protected onResize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (!this.pty) {
      this.start(width, height);
      return;
    }
    if (width === this.cols && height === this.rows) return;
    this.cols = width;
    this.rows = height;
    this.vt?.resize(width, height);
    this.pty.resize(width, height);
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (!this.vt) return;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.vt.readCell(x, y);
        // width 0 = the trailing half of a wide glyph already painted at x-1: skip it.
        if (cell && cell.width === 0 && cell.codepoint === 0) continue;
        const char = cell && cell.codepoint ? String.fromCodePoint(cell.codepoint) : " ";
        let fg = cell ? resolveColor(cell.fg, DEFAULT_FG) : DEFAULT_FG;
        let bg = cell ? resolveColor(cell.bg, TRANSPARENT) : TRANSPARENT;
        if (cell?.inverse) [fg, bg] = [bg, fg];
        const attributes = cell
          ? createTextAttributes({
              bold: cell.bold,
              italic: cell.italic,
              underline: cell.underline,
              dim: cell.faint,
              strikethrough: cell.strikethrough,
            })
          : 0;
        buffer.setCell(this.x + x, this.y + y, char, fg, bg, attributes);
      }
    }
    // cursor is active-area coords; equal to viewport at the bottom (the live
    // typing case). It can drift if the child scrolls the viewport back.
    const cursor = this.vt.readCursor();
    if (cursor.visible && cursor.x < this.width && cursor.y < this.height) {
      const under = this.vt.readCell(cursor.x, cursor.y);
      const char = under && under.codepoint ? String.fromCodePoint(under.codepoint) : " ";
      // a block cursor: paint the cell with fg/bg swapped
      buffer.setCell(this.x + cursor.x, this.y + cursor.y, char, CURSOR_INK, DEFAULT_FG, 0);
    }
  }

  /** Kill the child and free the VT. Idempotent - the detach path calls this
   *  directly because the React reconciler removes a child without destroying it. */
  shutdown(): void {
    this.pty?.kill();
    this.vt?.free();
    this.pty = null;
    this.vt = null;
  }

  protected destroySelf(): void {
    this.shutdown();
    super.destroySelf();
  }
}

/** Map a Ghostty cell color to an OpenTUI RGBA, using `fallback` for the terminal default. */
function resolveColor(color: GhosttyColor, fallback: RGBA): RGBA {
  if (color.kind === "rgb") return RGBA.fromInts(color.r, color.g, color.b, 255);
  if (color.kind === "palette") return RGBA.fromIndex(color.index);
  return fallback;
}

let registered = false;
/** Register `<terminalPane>` with the OpenTUI React reconciler (idempotent). */
export function registerTerminalPane(): void {
  if (registered) return;
  registered = true;
  extend({ terminalPane: TerminalPaneRenderable });
}
