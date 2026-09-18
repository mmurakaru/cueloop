/** Detects an image or other binary paste so a composer shows an [Image #n] placeholder instead of dumping raw bytes into the draft. */

const IMAGE_MAGIC_SIGNATURES: number[][] = [
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF87a / GIF89a
];

const CONTROL_RATIO_THRESHOLD = 0.15;
const PASTE_DECODER = new TextDecoder("utf-8", { fatal: false });

function hasImageMagic(bytes: Uint8Array): boolean {
  for (const signature of IMAGE_MAGIC_SIGNATURES) {
    if (signature.every((byte, index) => bytes[index] === byte)) return true;
  }

  const isRiffWebp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50; // P

  return isRiffWebp;
}

function isControlCodePoint(codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return false;

  return codePoint < 0x20 || codePoint === 0x7f;
}

/** True when a paste is an image or other non-text binary payload and should collapse to a placeholder. */
export function looksLikeBinaryPaste(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  if (hasImageMagic(bytes)) return true;

  const decoded = PASTE_DECODER.decode(bytes);
  let controlCount = 0;
  let total = 0;

  for (const character of decoded) {
    total += 1;
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint === 0 || codePoint === 0xfffd) return true;
    if (isControlCodePoint(codePoint)) controlCount += 1;
  }

  return total > 0 && controlCount / total > CONTROL_RATIO_THRESHOLD;
}

/** The draft placeholder for the nth image pasted into a composer: [Image #1], [Image #2], … */
export function imagePlaceholder(index: number): string {
  return `[Image #${index}]`;
}
