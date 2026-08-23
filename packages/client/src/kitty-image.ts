/**
 * Direct kitty graphics protocol emission for a cell rectangle. OpenTUI's
 * ImageRenderable does not display in every terminal, so prototype review paints
 * the screenshot itself: transmit the PNG once, then re-place it after each
 * frame over its reserved (never-repainted) cells, cell-addressed so it needs no
 * pixel-resolution report.
 */

export interface CellRegion {
  /** 0-based screen cell of the region's top-left corner. */
  column: number;
  row: number;
  columns: number;
  rows: number;
}

/** Writes a raw sequence ordered against the renderer's own frame output. */
export type OrderedWrite = (chunk: string) => void;

const ESCAPE_STRING_TERMINATOR = "\x1b\\";
const CHUNK_BYTES = 4096;

/** Save the cursor, run the placement at the region's corner, restore it. */
function atRegion(region: CellRegion, body: string): string {
  const moveToCorner = `\x1b[${region.row + 1};${region.column + 1}H`;
  return `\x1b7${moveToCorner}${body}\x1b8`;
}

function graphicsCommand(keys: string, payload: string): string {
  return `\x1b_G${keys};${payload}${ESCAPE_STRING_TERMINATOR}`;
}

/**
 * Transmit a PNG and display it filling the region's cells (a=T). f=100 is PNG,
 * C=1 keeps the cursor put so a full-region image cannot scroll the screen, and
 * q=2 suppresses the terminal's replies. Data over 4096 bytes is chunked.
 */
export function transmitKittyImage(
  write: OrderedWrite,
  png: Uint8Array,
  region: CellRegion,
  imageId: number,
): void {
  if (region.columns < 1 || region.rows < 1) return;
  const base64 = Buffer.from(png).toString("base64");
  // z<0 places the image beneath the text layer, so the marker popover and
  // compose card (ordinary cells) still paint over it
  const controlKeys = `a=T,f=100,i=${imageId},q=2,C=1,z=-1,c=${region.columns},r=${region.rows}`;
  let sequence = "";
  for (let offset = 0; offset < base64.length; offset += CHUNK_BYTES) {
    const chunk = base64.slice(offset, offset + CHUNK_BYTES);
    const isMore = offset + CHUNK_BYTES < base64.length ? 1 : 0;
    sequence +=
      offset === 0
        ? graphicsCommand(`${controlKeys},m=${isMore}`, chunk)
        : graphicsCommand(`m=${isMore}`, chunk);
  }
  write(atRegion(region, sequence));
}

/** Re-place an already-transmitted image over its region, cheaply (a=p, no data). */
export function placeKittyImage(write: OrderedWrite, region: CellRegion, imageId: number): void {
  if (region.columns < 1 || region.rows < 1) return;
  const command = graphicsCommand(
    `a=p,i=${imageId},q=2,C=1,z=-1,c=${region.columns},r=${region.rows}`,
    "",
  );
  write(atRegion(region, command));
}

/** Remove the image so it does not linger after the sheet closes (a=d). */
export function deleteKittyImage(write: OrderedWrite, imageId: number): void {
  write(graphicsCommand(`a=d,d=i,i=${imageId},q=2`, ""));
}
