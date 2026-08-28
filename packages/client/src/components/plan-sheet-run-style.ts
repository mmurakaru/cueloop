import { createTextAttributes } from "@opentui/core";
import type { DisplayBlock, StyleRun } from "../view-plan";
import type { Theme } from "../theme";

/** A cut block reads as removed: struck through and grayed, never red. */
const CUT_ATTRIBUTES = createTextAttributes({ strikethrough: true, dim: true });

/** Inline-emphasis attributes, reused per run so the render loop allocates none. */
const STRONG_ATTRIBUTES = createTextAttributes({ bold: true });
const EM_ATTRIBUTES = createTextAttributes({ italic: true });
const STRIKE_ATTRIBUTES = createTextAttributes({ strikethrough: true });
const LINK_ATTRIBUTES = createTextAttributes({ underline: true });
/** Block-level base attributes: headings read bold, blockquotes read italic. */
const HEADING_ATTRIBUTES = createTextAttributes({ bold: true });
const QUOTE_ATTRIBUTES = createTextAttributes({ italic: true });

interface BlockBaseStyle {
  baseFg: string;
  baseAttributes: number;
}

function isHeadingBlock(block: DisplayBlock): boolean {
  return block.kind === "h1" || block.kind === "h2" || block.kind === "h3";
}

// headings are all bold; level reads from descending brightness alone (a
// terminal cannot scale font size), leaving the salmon accent to annotations
function headingForeground(block: DisplayBlock, tokens: Theme): string | undefined {
  if (block.kind === "h1") return tokens.text;
  if (block.kind === "h2") return tokens.textMuted;
  if (block.kind === "h3") return tokens.textDim;
  return undefined;
}

function blockBaseStyle(block: DisplayBlock, tokens: Theme): BlockBaseStyle {
  const isHeading = isHeadingBlock(block);
  const isQuote = block.kind === "quote";
  const headingFg = headingForeground(block, tokens);
  // block-level base: headings bold, quotes muted italic; inline roles compose on top
  const baseFg = headingFg ?? (isQuote ? tokens.textMuted : tokens.text);
  const baseAttributes = (isHeading ? HEADING_ATTRIBUTES : 0) | (isQuote ? QUOTE_ATTRIBUTES : 0);
  return { baseFg, baseAttributes };
}

function inlineRoleStyle(
  run: StyleRun,
  base: BlockBaseStyle,
  tokens: Theme,
): { fg?: string; bg?: string; attributes?: number } {
  const { baseFg, baseAttributes } = base;
  const withBase = (roleAttributes: number): number => baseAttributes | roleAttributes;
  switch (run.role) {
    case "ins":
      return { fg: tokens.insertedForeground, attributes: baseAttributes || undefined };
    case "del":
      return { fg: tokens.deletedForeground };
    case "mark-comment":
      return { fg: tokens.text, bg: tokens.markCommentBackground };
    case "mark-focus":
      return { fg: tokens.accentInk, bg: tokens.accent };
    case "kspan":
      return { fg: tokens.accentInk, bg: tokens.accent };
    case "strong":
      return { fg: baseFg, attributes: withBase(STRONG_ATTRIBUTES) };
    case "em":
      return { fg: baseFg, attributes: withBase(EM_ATTRIBUTES) };
    case "code":
      return { fg: tokens.text, bg: tokens.elevated };
    case "strike":
      return { fg: tokens.textMuted, attributes: withBase(STRIKE_ATTRIBUTES) };
    case "link":
      return { fg: tokens.blue, attributes: withBase(LINK_ATTRIBUTES) };
    default:
      return { fg: baseFg, attributes: baseAttributes || undefined };
  }
}

export function runStyle(
  run: StyleRun,
  block: DisplayBlock,
  tokens: Theme,
): { fg?: string; bg?: string; attributes?: number } {
  // a cut block reads as removed: every run struck through and grayed, never red
  if (block.type === "del") return { fg: tokens.textDim, attributes: CUT_ATTRIBUTES };
  return inlineRoleStyle(run, blockBaseStyle(block, tokens), tokens);
}
