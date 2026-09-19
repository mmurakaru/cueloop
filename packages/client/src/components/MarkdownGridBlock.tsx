/**
 * Render a table or frontmatter display block as its grid: a GFM table (bold
 * header over a rule, aligned columns) or a leading-frontmatter key/value box.
 * Layout is computed in markdown-grid; this only paints the positioned segments,
 * dim for borders and bold for the header or key column. These blocks are
 * read-only structure, so the annotation surface treats them as non-annotatable
 * and this view registers no line for hit-testing.
 */

import React from "react";
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
}: {
  block: DisplayBlock;
  theme: Theme;
  contentWidth: number;
}): React.ReactNode {
  const lines = gridLines(block, Math.max(12, contentWidth));

  return (
    <box style={{ flexDirection: "column" }}>
      {lines.map((line, lineIndex) => (
        <box key={`grid-${lineIndex}`} style={{ flexDirection: "row" }}>
          <text selectable={false}>
            <span fg={theme.textDim}>{"  "}</span>
          </text>
          <text selectable={false}>
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
