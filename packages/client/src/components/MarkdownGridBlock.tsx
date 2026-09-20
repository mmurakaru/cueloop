/**
 * Render a table or frontmatter display block as its grid: a GFM table (bold
 * header over a rule, aligned columns) or a leading-frontmatter key/value box.
 * Layout is computed in markdown-grid; this only paints the positioned segments,
 * dim for borders and bold for the header or key column. The grid annotates as
 * one unit: every row registers the same block span for hit-testing, so a click
 * or drag anchors a comment on it and a mark tints the whole grid.
 */

import React from "react";
import type { MouseEvent as TerminalMouseEvent, TextRenderable } from "@opentui/core";
import { displayText, type DisplayBlock } from "../view-plan";
import type { Theme } from "../theme";
import { BOLD } from "../annotation-palette";
import {
  layoutFrontmatterGrid,
  layoutMarkdownTable,
  parseFrontmatterRows,
  parseMarkdownTable,
  type GridLine,
} from "../markdown-grid";

function gridLines(block: DisplayBlock, contentWidth: number): GridLine[] {
  if (block.kind === "table") return layoutMarkdownTable(parseMarkdownTable(displayText(block)));

  return layoutFrontmatterGrid(parseFrontmatterRows(displayText(block)), contentWidth);
}

export function MarkdownGridBlock({
  block,
  theme,
  contentWidth,
  marked = false,
  markBackdrop,
  registerRow,
  onRowMouseDown,
}: {
  block: DisplayBlock;
  theme: Theme;
  contentWidth: number;
  /** True while a discussion or held selection marks this grid; tints it so the annotation reads. */
  marked?: boolean;
  markBackdrop?: string;
  /** Registers a grid row's renderable with the annotation surface, all mapping to the one block span. */
  registerRow?: (rowIndex: number) => (renderable: TextRenderable | null) => void;
  onRowMouseDown?: (event: TerminalMouseEvent) => void;
}): React.ReactNode {
  const lines = gridLines(block, Math.max(12, contentWidth));

  return (
    <box style={{ flexDirection: "column", backgroundColor: marked ? markBackdrop : undefined }}>
      {lines.map((line, lineIndex) => (
        <box key={`grid-${lineIndex}`} style={{ flexDirection: "row" }}>
          <text selectable={false}>
            <span fg={theme.textDim}>{"  "}</span>
          </text>
          <text selectable={false} ref={registerRow?.(lineIndex)} onMouseDown={onRowMouseDown}>
            {line.map((segment, segmentIndex) => (
              <span
                key={segmentIndex}
                fg={segment.dim ? theme.textDim : theme.text}
                attributes={segment.bold ? BOLD : 0}
              >
                {segment.text}
              </span>
            ))}
          </text>
        </box>
      ))}
    </box>
  );
}
