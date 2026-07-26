# Research: @pierre/diffs and @pierre/trees audit

Resolves [#6](https://github.com/mmurakaru/cueloop/issues/6).
Researched 2026-07-26 against the npm registry, the source at [github.com/pierrecomputer/pierre](https://github.com/pierrecomputer/pierre), [diffs.com](https://diffs.com), and [trees.software](https://trees.software).

## Versions and licenses

| Package | Latest | Pre-release channels | License | Published |
| --- | --- | --- | --- | --- |
| `@pierre/diffs` | 1.2.12 | 1.3.0-rc.1 (`rc`), 1.3.0-beta.11 (`beta`) | Apache-2.0 | 1.2.12 on 2026-06-29; 1.3.0-rc.1 on 2026-07-24 |
| `@pierre/trees` | 1.0.0-beta.6 (`latest` tag points at a beta) | same | Apache-2.0 | 2026-07-25 |

Both packages live in the `pierrecomputer/pierre` monorepo (Apache-2.0 repo-wide; the maintainers standardized every package on Apache-2.0 in July 2026).
`@pierre/trees` has no stable release yet; its `latest` dist-tag is a beta.

## What @pierre/diffs provides

An open-source diff and file rendering library built on Shiki, shipped as vanilla JS classes and React wrappers.
Renders inside Shadow DOM with CSS Grid layout.

Entry points (`package.json` exports): `.`, `./ssr`, `./react`, `./worker` (plus worker bundles).
Dependencies: `diff@9`, `shiki ^3 || ^4`, `@shikijs/transformers`, `hast-util-to-html`, `@pierre/theme`, `lru_map`.
Peer dependencies: `react` and `react-dom` `^18.3.1 || ^19.0.0` (React is optional - only the `/react` entry needs it).

### React component API (`@pierre/diffs/react`)

Components: `File`, `FileDiff`, `PatchDiff`, `MultiFileDiff`, `UnresolvedFile` (merge conflicts), `CodeView` (virtualized multi-item surface), `Virtualizer`, `WorkerPoolContext`, `EditContext`.
Hooks/utilities: `useFileInstance`, `useFileDiffInstance`, `templateRender`.

Shared props (from `src/react/types.ts`):

```ts
export interface DiffBasePropsReact<LAnnotation> {
  options?: FileDiffOptions<LAnnotation>;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  selectedLines?: SelectedLineRange | null;
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderCustomHeader?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderPrefix?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderFilenameSuffix?(fileDiff: FileDiffMetadata): ReactNode;
  renderHeaderMetadata?(fileDiff: FileDiffMetadata): ReactNode;
  renderGutterUtility?(getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined): ReactNode;
  prerenderedHTML?: string; // SSR hydration
  // plus edit-mode props, metrics, className, style
}
```

Options (`BaseCodeOptions` / `BaseDiffOptions`): `theme`, `themeType` (`'system'` default), `diffStyle: 'unified' | 'split'`, `diffIndicators: 'classic' | 'bars' | 'none'`, `lineDiffType: 'word-alt' | 'word' | 'char' | 'none'` (inline character/word highlighting), `overflow: 'scroll' | 'wrap'`, `disableLineNumbers`, `hunkSeparators`, `expandUnchanged`, `stickyHeader`, `unsafeCSS` for custom CSS injection, and worker/highlighter tuning knobs.

### Annotation and interaction surface (the part cueloop cares about)

Annotations are line-anchored, not span-anchored:

```ts
export type LineAnnotation<T = undefined> = { lineNumber: number } & OptionalMetadata<T>;
export type DiffLineAnnotation<T = undefined> = {
  side: 'deletions' | 'additions';
  lineNumber: number;
} & OptionalMetadata<T>;
```

You pass `lineAnnotations` plus a `renderAnnotation` callback that returns arbitrary ReactNode (or `HTMLElement` in vanilla), rendered as a block attached to that line.
`lineNumber: 0` renders a file-level annotation above the first line.
Generic `metadata` carries your own payload (comment id, author, etc.), so threaded comment UIs are a supported first-class pattern.

Line selection is built in and controllable (`InteractionManagerBaseOptions`):

```ts
enableLineSelection?: boolean;
controlledSelection?: boolean;
onLineSelected?/onLineSelectionStart?/onLineSelectionChange?/onLineSelectionEnd?:
  (range: SelectedLineRange | null) => void;
// SelectedLineRange = { start, end, side?, endSide? }
```

Token-level interaction exists as events, with character offsets:

```ts
export interface TokenEventBase {
  type: 'token';
  lineNumber: number;
  lineCharStart: number;
  lineCharEnd: number;
  tokenText: string;
  tokenElement: HTMLElement;
}
// onTokenClick / onTokenEnter / onTokenLeave
```

Plus `onLineClick`, `onLineNumberClick`, `onLineEnter`/`onLineLeave`, hover highlighting modes, a gutter utility slot (`renderGutterUtility`, `onGutterUtilityClick`) for "add comment on this line" affordances, hunk expansion, and an imperative scroll API (`CodeViewScrollTarget` supports scrolling to a line or a `SelectedLineRange`).

There is no public API for persistent character-span decorations.
Shiki's `DecorationItem` type is re-exported, but internally `decorations` are reserved for the library's own inline word/char diff highlighting (`renderDiffWithHighlighter.ts` sets `decorations` itself and does not accept user-supplied ones).
Token hover/click events expose `lineCharStart`/`lineCharEnd` and the token element, so span-anchored UI is buildable, but anchoring is token-granular and event-driven - not a declarative "decorate chars 12-34 on line 7" API.

### Shiki integration and theming

- Highlighting is Shiki (`^3 || ^4`), with all bundled Shiki themes plus custom theme registration; a separate Pierre theme pack (`@pierre/theme`) is optional.
- Light/dark/system handled via `themeType`; components adapt to font, font-size, line-height, and `font-feature-settings`.
- Optional worker pool (`@pierre/diffs/worker` + `WorkerPoolContext`) moves tokenization off the main thread.

### SSR

`@pierre/diffs/ssr` exports `preloadDiffs`, `preloadFile`, `preloadPatchFile`, and `renderHTML`.
Flow: render HTML on the server, pass it to the component as `prerenderedHTML`, and the client hydrates.
Components render into Shadow DOM, which constrains global-CSS styling (escape hatch: `unsafeCSS`).

## What @pierre/trees provides

Path-first file tree UI: one implementation, four entry points - vanilla (`@pierre/trees`), `./react` (hooks + `<FileTree model={...} />`), `./ssr` (declarative-shadow-DOM preload helpers), `./web-components`.
It bundles its own rendering runtime as regular dependencies: `preact@11.0.0-beta.0`, `preact-render-to-string`, `@pierre/theming` (React is only a peer for the wrapper).

Vanilla model API: `new FileTree({ paths, initialExpansion, flattenEmptyDirectories, search })`, then `tree.render({ containerWrapper })`; mutation and query methods include `add`/`move`/`remove`/`resetPaths`, `setGitStatus(entries)`, `setIcons(config)`, `openSearch`/`setSearch`/`closeSearch`, `getSelectedPaths`, `getFocusedPath`, `scrollToPath`.
React layer: `FileTree` component plus `useFileTree`, `useFileTreeSelector`, `useFileTreeSelection`, `useFileTreeSearch`.
`preparePresortedFileTreeInput(paths)` pre-processes large path lists.
State is keyed by canonical path strings; rendering is inside a shadow root with built-in virtualization and git-status badges.

## Bundle weight

- `@pierre/diffs` 1.2.12: 5.2 MB unpacked on npm (includes worker bundles and type maps). The dominant runtime cost is Shiki itself - grammars/themes load on demand, and the worker entry keeps tokenization off the main thread. No official minified/gzip figure is published; treat "Shiki plus a rendering layer" as the budget.
- `@pierre/trees` 1.0.0-beta.6: 1.46 MB unpacked (244 files), carrying its own preact runtime, so it adds a second view-library copy to a React app (small, ~4 kB class of runtime, but not shared with your React).

## Maintenance signals

- Monorepo `pierrecomputer/pierre`: 5,547 stars, last push 2026-07-25 (yesterday), near-daily commit activity through July 2026.
- Issue/PR tracker is active and responsive: 1,000+ issues/PRs, items filed in the last week already closed (e.g. annotation overflow fix closed same-day on 2026-07-23), Dependabot enabled, active 1.3.0 beta/rc release train for diffs.
- Backed by The Pierre Computer Company (the library powers their commercial product), with multiple active maintainers publishing to npm.

## Gaps cueloop would need to fill

1. Span-level annotations: the annotation framework anchors to lines (plus a diff side), not character ranges. cueloop needs span-level annotations on rendered content, so it would have to build span anchoring itself - e.g. persist `{lineNumber, lineCharStart, lineCharEnd}` captured from token events, then overlay UI positioned off `tokenElement` rects, or patch highlighted output. Token events are token-granular, so arbitrary sub-token ranges need extra measurement work.
2. No user-supplied Shiki decorations/transformers pass-through: persistent inline highlights for annotated spans cannot be injected declaratively today; upstreaming a `decorations` option is a plausible contribution.
3. Shadow DOM styling: attached UI must live in the light DOM around the component or go through `unsafeCSS`; global stylesheets do not reach inside.
4. `@pierre/trees` is still beta (no 1.0.0 stable) and ships its own preact copy - acceptable but worth noting for bundle and API-stability budgets.
5. Annotation persistence, threading, and storage are entirely cueloop's concern; the library only renders what you pass and re-measures heights.

## Sources

- npm registry: `npm view @pierre/diffs` / `npm view @pierre/trees` (2026-07-26)
- https://github.com/pierrecomputer/pierre (packages/diffs, packages/trees source: `src/types.ts`, `src/react/types.ts`, `src/managers/InteractionManager.ts`, `src/ssr/index.ts`, `src/utils/renderDiffWithHighlighter.ts`, READMEs)
- https://diffs.com
- https://trees.software
