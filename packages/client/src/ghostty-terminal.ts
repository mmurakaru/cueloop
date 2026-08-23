/**
 * A live in-process terminal emulator backed by Ghostty's VT core (libghostty-vt)
 * through a flat FFI shim (native/src/shim.zig). Feed it a child process's PTY
 * output with `write`, then read the rendered screen cell-by-cell with `readCell`
 * to paint it anywhere - this is what lets a real `cc`/shell render inside an
 * OpenTUI box. Load with `loadGhosttyTerminals`, which returns null when no
 * prebuilt dylib exists for this platform (callers fall back to a herdr split).
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** How a cell's color arrived from Ghostty: the terminal default, an ANSI palette index, or true RGB. */
export type GhosttyColor =
  | { kind: "default" }
  | { kind: "palette"; index: number }
  | { kind: "rgb"; r: number; g: number; b: number };

/** The cursor's viewport position and whether it should be drawn. */
export interface GhosttyCursor {
  x: number;
  y: number;
  visible: boolean;
}

/** One decoded screen cell: its glyph, colors, cell width, and text decorations. */
export interface GhosttyCell {
  /** Unicode code point; 0 = blank. */
  codepoint: number;
  fg: GhosttyColor;
  bg: GhosttyColor;
  /** Ghostty width tag: 0 = normal, 1 = double-width lead, 2 = trailing cell. */
  width: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  faint: boolean;
  strikethrough: boolean;
}

const CVT_SYMBOLS = {
  cvt_new: { args: [FFIType.u16, FFIType.u16], returns: FFIType.ptr },
  cvt_free: { args: [FFIType.ptr], returns: FFIType.void },
  cvt_write: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.void },
  cvt_resize: { args: [FFIType.ptr, FFIType.u16, FFIType.u16], returns: FFIType.void },
  cvt_cell: { args: [FFIType.ptr, FFIType.u16, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  cvt_cursor: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
} as const;

type CvtLib = ReturnType<typeof dlopen<typeof CVT_SYMBOLS>>["symbols"];

/** The prebuilt shim dylib for this platform, or null when none ships for it. */
function nativeLibraryPath(): string | null {
  const suffix = process.platform === "darwin" ? "dylib" : "so";
  const dir = `${process.platform}-${process.arch}`;
  const path = join(import.meta.dir, "..", "native", dir, `libcueloopvt.${suffix}`);
  return existsSync(path) ? path : null;
}

/**
 * Open the Ghostty VT library for this platform, or return null when the prebuilt
 * dylib is missing (the caller degrades to a herdr split instead of embedding).
 */
export function loadGhosttyTerminals(): GhosttyTerminalFactory | null {
  const path = nativeLibraryPath();
  if (!path) return null;
  try {
    const lib = dlopen(path, CVT_SYMBOLS);
    return new GhosttyTerminalFactory(lib.symbols);
  } catch (error) {
    // The file exists but failed to load (bad arch, missing symbol) - a real
    // fault, not the expected no-prebuilt case; surface it, then degrade.
    console.error(`cueloop: failed to load ${path}:`, error);
    return null;
  }
}

/** Creates `GhosttyTerminal`s that share one loaded copy of the VT library. */
export class GhosttyTerminalFactory {
  constructor(private readonly lib: CvtLib) {}
  /** A fresh terminal sized to cols x rows, or null if allocation failed. */
  create(cols: number, rows: number): GhosttyTerminal | null {
    const handle = this.lib.cvt_new(cols, rows);
    return handle ? new GhosttyTerminal(this.lib, handle) : null;
  }
}

// The flat CvtCell struct the shim writes: u32 codepoint, fg rgba-ish (4 bytes),
// bg (4 bytes), u8 width, u8 flags, u16 pad = 16 bytes.
const CELL_STRUCT_BYTES = 16;
const FLAG_BOLD = 1;
const FLAG_ITALIC = 2;
const FLAG_UNDERLINE = 4;
const FLAG_INVERSE = 8;
const FLAG_FAINT = 16;
const FLAG_STRIKETHROUGH = 32;

/** A live Ghostty terminal: feed PTY bytes, read the screen, resize, free. */
export class GhosttyTerminal {
  private readonly out = new Uint8Array(CELL_STRUCT_BYTES);
  private readonly outView = new DataView(this.out.buffer);
  private readonly cursorOut = new Uint8Array(8);
  private freed = false;

  constructor(
    private readonly lib: CvtLib,
    private readonly handle: NonNullable<ReturnType<CvtLib["cvt_new"]>>,
  ) {}

  /** Process a chunk of the child's PTY output into the screen state. */
  write(bytes: Uint8Array): void {
    if (this.freed || bytes.length === 0) return;
    this.lib.cvt_write(this.handle, ptr(bytes), BigInt(bytes.length));
  }

  /** Resize the screen (and the child's tty, via the caller) to cols x rows. */
  resize(cols: number, rows: number): void {
    if (this.freed) return;
    this.lib.cvt_resize(this.handle, cols, rows);
  }

  /** The rendered cell at viewport (x, y), or null when out of range. */
  readCell(x: number, y: number): GhosttyCell | null {
    if (this.freed) return null;
    if (this.lib.cvt_cell(this.handle, x, y, ptr(this.out)) !== 0) return null;
    const flags = this.out[13]!;
    return {
      codepoint: this.outView.getUint32(0, true),
      fg: decodeColor(this.out[7]!, this.out[4]!, this.out[5]!, this.out[6]!),
      bg: decodeColor(this.out[11]!, this.out[8]!, this.out[9]!, this.out[10]!),
      width: this.out[12]!,
      bold: (flags & FLAG_BOLD) !== 0,
      italic: (flags & FLAG_ITALIC) !== 0,
      underline: (flags & FLAG_UNDERLINE) !== 0,
      inverse: (flags & FLAG_INVERSE) !== 0,
      faint: (flags & FLAG_FAINT) !== 0,
      strikethrough: (flags & FLAG_STRIKETHROUGH) !== 0,
    };
  }

  /** The cursor's current viewport position and visibility. */
  readCursor(): GhosttyCursor {
    if (this.freed) return { x: 0, y: 0, visible: false };
    this.lib.cvt_cursor(this.handle, ptr(this.cursorOut));
    const view = new DataView(this.cursorOut.buffer);
    return {
      x: view.getUint16(0, true),
      y: view.getUint16(2, true),
      visible: this.cursorOut[4] === 1,
    };
  }

  /** Release the terminal; further calls are no-ops. Call once on teardown. */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.lib.cvt_free(this.handle);
  }
}

/** Decode the shim's (kind, r, g, b) color triple; palette carries its index in r. */
function decodeColor(kind: number, r: number, g: number, b: number): GhosttyColor {
  if (kind === 2) return { kind: "rgb", r, g, b };
  if (kind === 1) return { kind: "palette", index: r };
  return { kind: "default" };
}
