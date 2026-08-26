/**
 * Direct kitty graphics protocol emission for a cell rectangle. OpenTUI's
 * ImageRenderable does not display in every terminal, so prototype review paints
 * the screenshot itself: transmit the PNG once under a fixed image AND placement
 * id, then re-place that same placement after each frame over its reserved
 * (never-repainted) cells. Reusing one placement id means each frame REPLACES
 * the placement rather than stacking a new one, which is the protocol's
 * flicker-free move/resize path. Locally the PNG travels out of band via a
 * temporary file so its bytes never cross the pty; a base64 fallback covers the
 * ssh sharing path where no shared filesystem exists.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CellRegion {
  /** 0-based screen cell of the region's top-left corner. */
  column: number;
  row: number;
  columns: number;
  rows: number;
}

/** Writes a raw sequence ordered against the renderer's own frame output. */
export type OrderedWrite = (chunk: string) => void;

export type TransmitMedium = "file" | "base64";

const ESCAPE_STRING_TERMINATOR = "\x1b\\";
const CHUNK_BYTES = 4096;
// The protocol reserves values below INT32_MIN/2 for images that must sit
// beneath cells with painted backgrounds, such as the marker popover.
const IMAGE_Z_INDEX = -1_073_741_825;
// One fixed placement per image: reusing it makes every put replace that
// placement instead of accumulating a new one each frame.
const PLACEMENT_ID = 1;
const SYNCHRONIZED_UPDATE_START = "\x1b[?2026h";
const SYNCHRONIZED_UPDATE_END = "\x1b[?2026l";

let tempFileCounter = 0;

/**
 * base64 is the safe default: it works over the pty everywhere, including the
 * ssh sharing path. Out-of-band file transfer (t=t) is faster for the initial
 * transmit but depends on the terminal trusting the temp-file path, so it is
 * opt-in via `CUELOOP_KITTY_FILE=1` and never used over ssh (no shared disk).
 */
export function resolveTransmitMedium(env: NodeJS.ProcessEnv = process.env): TransmitMedium {
  if (env.CUELOOP_KITTY_FILE === "1" && !env.SSH_CONNECTION && !env.SSH_TTY) return "file";
  return "base64";
}

/** Save the cursor, run the placement at the region's corner, restore it. */
function atRegion(region: CellRegion, body: string): string {
  const moveToCorner = `\x1b[${region.row + 1};${region.column + 1}H`;
  return `\x1b7${moveToCorner}${body}\x1b8`;
}

function graphicsCommand(keys: string, payload: string): string {
  return `\x1b_G${keys};${payload}${ESCAPE_STRING_TERMINATOR}`;
}

function placementKeys(imageId: number, region: CellRegion): string {
  return `i=${imageId},p=${PLACEMENT_ID},q=2,C=1,z=${IMAGE_Z_INDEX},c=${region.columns},r=${region.rows}`;
}

function writeTempPng(png: Uint8Array): string {
  const path = join(tmpdir(), `cueloop-prototype-${process.pid}-${tempFileCounter++}.png`);
  writeFileSync(path, png);
  return path;
}

function base64Transmit(png: Uint8Array, region: CellRegion, imageId: number): string {
  const base64 = Buffer.from(png).toString("base64");
  const controlKeys = `a=T,f=100,${placementKeys(imageId, region)}`;
  let sequence = "";
  for (let offset = 0; offset < base64.length; offset += CHUNK_BYTES) {
    const chunk = base64.slice(offset, offset + CHUNK_BYTES);
    const isMore = offset + CHUNK_BYTES < base64.length ? 1 : 0;
    sequence +=
      offset === 0
        ? graphicsCommand(`${controlKeys},m=${isMore}`, chunk)
        : graphicsCommand(`m=${isMore}`, chunk);
  }
  return sequence;
}

function fileTransmit(png: Uint8Array, region: CellRegion, imageId: number): string {
  const path = writeTempPng(png);
  const payload = Buffer.from(path).toString("base64");
  return graphicsCommand(`a=T,f=100,t=t,${placementKeys(imageId, region)}`, payload);
}

/**
 * Transmit a PNG and display it filling the region's cells (a=T). f=100 is PNG,
 * C=1 keeps the cursor put so a full-region image cannot scroll the screen, and
 * q=2 suppresses the terminal's replies. The whole write is bracketed in
 * synchronized-update mode so the terminal composites it atomically. `file`
 * hands over a temp path (t=t: the terminal deletes it after reading); `base64`
 * inlines the data, chunked at 4096 bytes.
 */
export function transmitKittyImage(
  write: OrderedWrite,
  png: Uint8Array,
  region: CellRegion,
  imageId: number,
  medium: TransmitMedium = "base64",
): void {
  if (region.columns < 1 || region.rows < 1) return;
  const body =
    medium === "file" ? fileTransmit(png, region, imageId) : base64Transmit(png, region, imageId);
  write(SYNCHRONIZED_UPDATE_START + atRegion(region, body) + SYNCHRONIZED_UPDATE_END);
}

/** Re-place the already-transmitted image over its region, cheaply (a=p, no data). */
export function placeKittyImage(write: OrderedWrite, region: CellRegion, imageId: number): void {
  if (region.columns < 1 || region.rows < 1) return;
  write(atRegion(region, graphicsCommand(`a=p,${placementKeys(imageId, region)}`, "")));
}

/** Remove the image so it does not linger after the sheet closes (a=d). */
export function deleteKittyImage(write: OrderedWrite, imageId: number): void {
  write(graphicsCommand(`a=d,d=i,i=${imageId},q=2`, ""));
}
