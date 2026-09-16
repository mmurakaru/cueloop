/** WCAG colour maths for the visual-regression layer: relative luminance and the contrast ratio used
 * to gate that text stays readable in both the dark and light themes. sRGB channels are 0-255. */

export type Rgb = readonly [number, number, number];

/** Parse a `#rrggbb` hex colour into an sRGB triple. */
export function rgbFromHex(hex: string): Rgb {
  const value = hex.replace("#", "");

  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function relativeLuminance(rgb: Rgb): number {
  const linear = rgb.map((channel) => {
    const ratio = channel / 255;

    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** WCAG contrast ratio between two sRGB colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));

  return (lighter + 0.05) / (darker + 0.05);
}
