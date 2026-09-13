# Prototype review: a text-based default format

## Question

Today the `prototype` primitive renders an HTML mockup to pixels in the terminal (kitty graphics protocol) and anchors annotations to DOM elements.
Pixels are not text-annotatable, so the prototype primitive needs a bespoke anchor path.
We want to make pixel rendering an opt-in TOML flag and default the `prototype` primitive to a text format that the existing line/character annotation anchors to natively.

Two review targets:

1. Component API / interface review: a reviewer comments on a component's props, interface, and type surface.
2. Composition review: a reviewer comments on the slot/primitive tree of a component (which primitives it reuses, how it nests) and on a comparison of design options side by side.

## How cueloop anchors today (grounding)

Anchors are quote-primary selectors.
The recorded quote is the authority; block index and character offsets are hints only.
See `packages/schema/src/types.ts:102-120` and the resolver cascade in `packages/schema/src/anchor.ts:1-17` and `:351-386`.
The cascade tries exact, then trimmed, then normalized, then a similarity-bounded fuzzy match, else it orphans the quote.

A markdown artifact is parsed into addressable blocks.
The block kinds are `h1`, `h2`, `h3`, `p`, `li`, `oli`, `quote`, `code`, and `hr` (`packages/schema/src/markdown.ts:9`).
There is no table kind and no nested-list kind.
Unknown constructs fall back to paragraph blocks so no content is lost (`packages/schema/src/markdown.ts:1-7` and `:124-137`).
A GFM table therefore parses as one paragraph block that holds every row, not one block per cell.

A fenced code block is kept verbatim as one block, with its info string recorded as `lang` (`packages/schema/src/markdown.ts:52-66`).
The projection keeps code literal but still positions every character, so marks and word spans bind inside a code block the same as inside prose (`packages/client/src/view-plan.ts:245-282`).
Character and word span selection works in any block, code included (`packages/client/src/view-plan.ts:195-242` for marks, `:482-557` for word spans).
This is the load-bearing fact: a reviewer can select and comment on any word or span of a fenced code block, so an extracted type signature or an ASCII diagram inside a fence is fully annotatable.

`plan` and `reply` are markdown artifacts; they share the block parse, the quote-anchor path, and the plan render path (`packages/schema/src/types.ts:40-48`).
`diff` and `prototype` do not.
The prototype anchor is a CSS selector that points at a DOM element, and the selector is the authority, not a quote (`packages/schema/src/types.ts:118-119`, `packages/client/src/prototype-browser.ts:8-15` and `:199-287`).
Pixel rendering runs headless Chromium through puppeteer-core, imported lazily so plan and diff review never load it (`packages/client/src/prototype-browser.ts:2-6` and `:105-136`).

Config is layered TOML, validated with valibot, with feature-scoped sections such as `[ui]` and `[integrations.obsidian]` (`packages/client/src/config.ts:1-6` and `:139-178`).
A render-mode flag for the prototype primitive fits this shape directly.
`ARTIFACT_TYPES` is one runtime union that drives daemon wire validation, CLI flag parsing, and adapter tool schemas (`packages/schema/src/types.ts:21-33`), so a text prototype needs no new primitive if it reuses the markdown path.

## Candidate formats

Each candidate is judged on: (a) anchor fit to cueloop's quote-primary text anchor; (b) API/interface expression; (c) composition and option comparison; (d) tooling maturity; (e) authoring cost for an AI agent; (f) rich browser render while staying line-addressable plain text.

### Markdown (the existing plan/reply path)

(a) Native.
It is the exact input the block parser and the quote anchor already consume (`packages/schema/src/markdown.ts:40-141`).
No new anchor code is needed.
(b) Good, through a fenced code block.
An extracted `interface`/`type` signature lives in a ```` ```ts ```` fence and reads as one verbatim, annotatable block.
(c) Adequate.
Headings, lists, and blockquotes give a section tree.
A fenced ASCII/Unicode box diagram expresses nesting.
An option comparison is a limitation: a GFM table degrades to one paragraph block, so cell-level structure is lost, but the text stays character-addressable, so a reviewer can still select any cell text.
(d) Very mature: many parsers and renderers.
(e) Lowest authoring cost for an agent.
(f) Renders rich in any browser and stays plain, line-addressable text.

### MDX

(a) Poor.
MDX mixes JSX into markdown, so the block parser would treat component tags and expressions as paragraph fallback and the reviewer would annotate source noise, not rendered content.
(b)/(c) Rich, but only after a JS/JSX runtime evaluates it.
(d) Mature in the JS ecosystem.
(e) Higher: the agent must write valid JSX and imports.
(f) It needs compilation and a React runtime to render; it is not a render-free plain-text artifact.
Verdict: rejected as the default; the runtime cost defeats the point.
Source: https://mdxjs.com/docs/what-is-mdx/

### TypeScript type-signature extraction (react-docgen-typescript, TypeDoc, ts-morph, API Extractor)

These are producers of the API section, not a review format on their own.
`react-docgen-typescript` parses a component's TypeScript props into structured metadata (name, type, JSDoc description, default), which is what Storybook's props panel consumes; only named exports are supported.
Source: https://github.com/styleguidist/react-docgen-typescript and https://www.npmjs.com/package/react-docgen-typescript
`ts-morph` is a wrapper over the TypeScript compiler API for programmatic navigation of declarations; it is the flexible way to read an interface or type and emit its text.
Source: https://ts-morph.com/
`TypeDoc` generates documentation from TypeScript declarations and doc comments.
Source: https://typedoc.org/
Microsoft API Extractor emits an `.api.md` report: a Markdown file that is mostly a block of pseudocode summarizing the public API signatures, designed so a diff appears only on a real contract change.
Source: https://api-extractor.com/pages/overview/demo_api_report/
This last point is the key finding for target 1.
An agent can generate the interface section as a fenced code block of extracted signatures, exactly the shape API Extractor already proves is review-friendly, and cueloop annotates it as plain text with no new code.
(a) Native once the output is placed in a fence.
(b) Excellent.
(c) Not applicable (interface only).
(d) Mature.
(e) Low to medium: the agent runs one extractor and pastes the result.
(f) The extracted text renders rich in any markdown viewer.

### Storybook Component Story Format (CSF) and args/argTypes

CSF files are ES modules: a default export of component metadata plus named exports for stories.
`args` is a JSON-serializable input set; `argTypes` encodes per-arg metadata (name, description, type, default), inferred by static analysis and overridable.
Sources: https://storybook.js.org/docs/api/csf and https://storybook.js.org/docs/api/arg-types
(a) Poor as a review surface: CSF is executable JS, so it annotates as source, not as a rendered interface.
(b) The `argTypes` model is a strong, well-specified schema for the prop surface, and worth mirroring as the field set of a manifest (see below).
(c) Weak for composition and option comparison.
(d) Mature.
(e) Medium.
(f) It needs the Storybook runtime to render.
Verdict: not the artifact, but a proven vocabulary to borrow for the interface fields.

### ASCII / Unicode box "composition" diagrams

A nested labeled-box tree drawn with box-drawing characters, inside a fenced code block.
(a) Native: a fence is one verbatim, fully annotatable block, and a reviewer can span-select any box or label (`packages/client/src/view-plan.ts:245-282`).
(b) Weak for a precise type surface.
(c) Strong for the nesting tree, which is exactly target 2's "composition diagram".
(d) The renderer is the terminal itself; generators exist, and an agent writes them well by hand.
(e) Low for an agent.
(f) Renders identically in a browser `<pre>` and in the terminal, and stays plain text.
This is the best fit for the composition tree specifically.

### Diagram-as-text: Mermaid, D2, PlantUML

Mermaid renders natively inside GitHub and GitLab markdown with no external render step; D2 and PlantUML render natively in none of them.
Source: https://text-to-diagram.com/ and https://d2lang.com/tour/faq/
D2 groups nested containers with `vpc { api; auth; db }` and has the strongest layout engine; PlantUML covers the full UML set but is verbose; Mermaid's layout weakens past a dozen nodes.
Sources: https://d2lang.com/tour/faq/ and https://text-to-diagram.com/
(a) Mixed.
The diagram source is plain text and lives in a fence, so it annotates as text.
But the reviewer then annotates diagram source (`A --> B`), not the rendered picture, which is a worse comment target than a labeled ASCII box the reviewer reads directly.
(b) Weak for a type surface.
(c) Good for a node/edge tree; container syntax expresses nesting.
(d) Mermaid and PlantUML are very mature; D2 is newer with the cleanest nesting syntax.
(e) Low for an agent to author.
(f) None render inline in a raw terminal without a render pass; they render rich only in a browser or a diagram service.
Verdict: a secondary, opt-in enrichment for a browser export, not the terminal default.

### JSON / YAML component manifest

A structured record of the component: name, an `argTypes`-style prop list, the primitives it reuses, and the option set.
(a) Weak as the primary review surface: a reviewer annotating raw JSON keys and punctuation is annotating serialization, not meaning, even though it is technically text-anchorable.
(b) Strong as machine-readable data.
(c) Strong as the source of truth an agent renders the human view from.
(d) Mature.
(e) Low for an agent (it is generating data).
(f) It renders rich only after a renderer turns it into prose, a table, or a diagram.
Verdict: a good hidden source of truth behind the artifact, not the artifact the human annotates.

### Single-file component formats (.astro, .svelte, .vue SFC)

(a) Poor: these are source files with template, script, and style sections, so the reviewer annotates code, not a rendered interface or composition.
(b)/(c) They describe one real component, not a comparison of options or an abstract composition tree.
(d) Mature within their frameworks.
(e) Higher, and framework-locked.
(f) They need a framework compiler to render.
Verdict: rejected; these are implementation files, not review artifacts.

### Literate formats (prose + code + rendered preview)

The general class that mixes narrative, code, and an embedded preview.
Markdown with fenced code is the render-free member of this class.
The members that embed a live preview (notebook or MDX style) all need a runtime, which the terminal default must avoid.
Verdict: the render-free member is the recommendation below; the live-preview members are the opt-in pixel path.

## Challenging the framing

One format or two.
Interface review and composition review are two different artifacts that want two different sections, not two different files.
The interface section is a code-fenced signature block.
The composition section is a code-fenced box tree plus a prose or list option comparison.
Both are sections of one markdown document, so they share one artifact, one anchor path, and one review session.
Keep them as sections, not as separate primitives.

What pixel rendering genuinely loses.
Dropping pixels as the default loses true visual fidelity: exact spacing, color, type, state, and responsive layout.
For a pure look-and-feel judgment ("does this screen feel right"), that loss is real and text cannot replace it.
That is the case the opt-in pixel flag must still serve.
For the two stated targets (interface correctness and composition/reuse), pixel fidelity was never the point; those are structural judgments that text serves better, because the reviewer can point at the exact prop or the exact nested box.

Simplest versus richest.
The simplest thing that works is a plain markdown document with two fenced sections, authored by the agent and reviewed on the existing plan path with zero new anchor code.
The richest thing is a manifest-driven artifact with generated Mermaid/D2 diagrams and a browser preview.
The sweet spot for an agent-authored, human-annotated, terminal-reviewed artifact is the simple markdown document, optionally generated from a hidden manifest, with diagram-as-text and pixels as opt-in enrichments.

## Recommendation

Primary default: a Markdown artifact that reuses the existing plan/reply path.
Make the prototype text artifact a markdown artifact so `isMarkdownArtifact` includes it (`packages/schema/src/types.ts:40-48`) and it inherits the block parse, the quote anchor, and the plan renderer with no new anchor code.

Structure the document as two sections:

1. Interface: a ```` ```ts ```` fenced block holding the extracted prop/interface surface, generated with `ts-morph` or `react-docgen-typescript`, in the shape API Extractor's `.api.md` report already proves is review-friendly.
2. Composition: a fenced ASCII/Unicode box tree for the nesting and reuse, followed by an option comparison written as a list or short prose (not a GFM table, because a table degrades to one paragraph block per `packages/schema/src/markdown.ts:124-137`).

Secondary, opt-in: keep pixel rendering behind a TOML flag, and allow a diagram-as-text enrichment (Mermaid) for a browser export.
Pixels stay the right tool for pure visual-fidelity review.

Rationale tied to anchoring.
Every section above is plain, block-parseable, character-addressable text, so the quote-primary cascade in `packages/schema/src/anchor.ts:351-386` binds a comment to the exact word or span with no bespoke selector path.
The DOM-selector anchor (`packages/schema/src/types.ts:118-119`) becomes needed only when the reviewer opts into pixels.

## Integration sketch

Authoring.
The submitting agent generates one markdown file: prose, one ```` ```ts ```` interface fence from a type extractor, and one fenced composition box tree with an option list.
Optionally the agent generates this file from a hidden JSON/YAML manifest so the machine data and the human view stay in sync.

Rendering.
Route the text prototype through the markdown render path, not the Chromium path.
Gate pixels with a TOML flag, for example `[prototype] render = "text" | "pixels"` in the layered config (`packages/client/src/config.ts:139-178`), defaulting to `text`.
When the flag is `pixels`, keep the current lazy puppeteer path (`packages/client/src/prototype-browser.ts:105-136`).

Anchoring.
Text mode reuses the quote-primary anchor with no change (`packages/schema/src/anchor.ts:351-386`).
Pixel mode keeps the CSS-selector anchor (`packages/schema/src/types.ts:118-119`).
The `Anchor` type already carries both `quote` and the optional `selector`, so both modes fit the current schema.

Wire and CLI.
Because `prototype` stays one member of `ARTIFACT_TYPES` (`packages/schema/src/types.ts:21-33`), the daemon validation, the CLI flags, and the adapter schemas need no new primitive; only the render branch and the isMarkdownArtifact membership change.

## Comparison table

| Format | Anchor fit | Interface | Composition + options | Tooling | Agent authoring | Rich in browser, stays plain text | Role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Markdown (plan path) | Native | Good (fenced) | Adequate | Very mature | Lowest | Yes | Primary default |
| Type extraction output | Native in a fence | Excellent | n/a | Mature | Low | Yes | Fills interface section |
| ASCII/Unicode box tree | Native in a fence | Weak | Strong for tree | Terminal-native | Low | Yes | Fills composition section |
| CSF args/argTypes | Poor (source) | Strong schema | Weak | Mature | Medium | Needs runtime | Borrow field vocabulary |
| Mermaid / D2 / PlantUML | Mixed (source, not picture) | Weak | Good | Mermaid/PlantUML mature, D2 newer | Low | Needs render pass | Opt-in browser enrichment |
| JSON/YAML manifest | Weak (serialization) | Strong data | Strong data | Mature | Low | Needs renderer | Hidden source of truth |
| MDX | Poor | Rich | Rich | Mature | Medium | Needs runtime | Rejected as default |
| .astro/.svelte/.vue SFC | Poor (source) | n/a | n/a | Mature | Higher | Needs compiler | Rejected |
| Pixel HTML (today) | Bespoke DOM selector | Visual only | Visual only | Mature | Medium | It is pixels | Opt-in visual fidelity |

## Sources

- cueloop schema types: `packages/schema/src/types.ts:21-33`, `:40-48`, `:102-120`, `:118-119`
- cueloop anchor cascade: `packages/schema/src/anchor.ts:1-17`, `:351-386`
- cueloop block model: `packages/schema/src/markdown.ts:9`, `:1-7`, `:52-66`, `:124-137`
- cueloop projection and spans: `packages/client/src/view-plan.ts:195-242`, `:245-282`, `:482-557`
- cueloop prototype pixel path: `packages/client/src/prototype-browser.ts:2-6`, `:8-15`, `:105-136`, `:199-287`
- cueloop layered TOML config: `packages/client/src/config.ts:1-6`, `:139-178`
- react-docgen-typescript: https://github.com/styleguidist/react-docgen-typescript and https://www.npmjs.com/package/react-docgen-typescript
- ts-morph: https://ts-morph.com/
- TypeDoc: https://typedoc.org/
- API Extractor API report (`.api.md`): https://api-extractor.com/pages/overview/demo_api_report/
- Storybook CSF and argTypes: https://storybook.js.org/docs/api/csf and https://storybook.js.org/docs/api/arg-types
- MDX: https://mdxjs.com/docs/what-is-mdx/
- Diagram-as-text comparison: https://text-to-diagram.com/ and https://d2lang.com/tour/faq/
