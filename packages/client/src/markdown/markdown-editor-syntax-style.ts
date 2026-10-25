/**
 * The native SyntaxStyle for the inline markdown editor: maps each markdown
 * token group to a theme color and attribute set, and resolves the styleId the
 * edit buffer needs for `addHighlightByCharRange`. Cached per theme, mirroring
 * syntaxStyleFor. Syntax punctuation (the "marker" group) is dimmed rather than
 * hidden, since the editor shows raw source.
 */

import {
  SyntaxStyle,
  type NativeResourceOwner,
  type ResourceContext,
  type StyleDefinitionInput,
} from "@opentui/core";
import { type Theme } from "../appearance/theme";
import { MARKDOWN_HIGHLIGHT_GROUPS, type MarkdownHighlightGroup } from "./markdown-highlight";

/** A markdown SyntaxStyle plus the lookup from token group to its native styleId. */
export interface MarkdownEditorStyle {
  style: SyntaxStyle;
  styleIdFor: (group: MarkdownHighlightGroup) => number;
}

function markdownGroupStyles(theme: Theme): Record<MarkdownHighlightGroup, StyleDefinitionInput> {
  return {
    heading: { bold: true },
    marker: { fg: theme.textDim },
    link: { fg: theme.blue, underline: true },
    code: { fg: theme.textDim },
  };
}

const markdownEditorStyleCache = new WeakMap<
  ResourceContext,
  WeakMap<Theme, MarkdownEditorStyle>
>();

/** Build (or reuse) the markdown editor's SyntaxStyle for a theme, with a group-to-styleId lookup. */
export function markdownEditorStyle(theme: Theme, owner: NativeResourceOwner): MarkdownEditorStyle {
  let byTheme = markdownEditorStyleCache.get(owner.resourceContext);

  if (!byTheme) {
    byTheme = new WeakMap<Theme, MarkdownEditorStyle>();
    markdownEditorStyleCache.set(owner.resourceContext, byTheme);
  }

  const cached = byTheme.get(theme);

  if (cached) return cached;

  const groupStyles = markdownGroupStyles(theme);
  const style = SyntaxStyle.fromStyles(groupStyles, owner);
  const styleIds = new Map<MarkdownHighlightGroup, number>();

  for (const group of MARKDOWN_HIGHLIGHT_GROUPS) {
    styleIds.set(group, style.getStyleId(group) ?? 0);
  }
  const entry: MarkdownEditorStyle = {
    style,
    styleIdFor: (group) => styleIds.get(group) ?? 0,
  };

  byTheme.set(theme, entry);

  return entry;
}
