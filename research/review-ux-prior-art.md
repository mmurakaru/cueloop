# Prior art in review UX: annotating markdown, diffs, and file trees

Resolves [#15](https://github.com/mmurakaru/cueloop/issues/15).

cueloop's core loop - agent submits a plan or diff, a human annotates in the browser, a verdict plus structured feedback returns - is a review-session primitive.
This survey catalogs how existing review tools handle five axes: annotation anchoring, pending-feedback batching, edit-vs-comment coexistence, keyboard model, and sidebar vs on-demand summary.
It closes with a shortlist of patterns to adopt and patterns to deliberately avoid.

## Pattern catalog

### GitHub PR review

Source: [Reviewing proposed changes in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request), [Mark files as viewed](https://github.blog/news-insights/product-news/mark-files-as-viewed/).

- Anchoring: line-anchored on the diff; multi-line via click first line, shift-click last line.
- Batching: inline comments are "pending and only visible to you" until the review is submitted; editable at any time before submit.
- Submit: "Review changes" collects a summary comment plus a verdict (Comment / Approve / Request changes), then one submit publishes everything atomically.
  This is the closest existing model to cueloop's planned flow.
- Edit vs comment: "suggested changes" embed a proposed edit inside a comment; the author can commit it with one click.
  Editing the artifact and commenting on it stay in one channel - the suggestion is a comment that carries a diff.
- Progress: "Mark as viewed" collapses a file and advances a progress bar; if the file changes afterward, viewed status is revoked with a "changed since last view" badge.
- Sidebar: no persistent review sidebar; pending state lives in a header counter, and the summary appears only in the submit popover.
  Community threads ([#45478](https://github.com/orgs/community/discussions/45478), [#196477](https://github.com/orgs/community/discussions/196477)) show the recurring pain is finding your own pending comments again, which argues for at least an on-demand pending-annotation list.

### Graphite

Source: [Review pull requests](https://graphite.com/docs/review-pull-requests).

- Batching: as inline comments accumulate, "the count of pending comments in the PR header is incremented, and the add review button text changes to finish review".
  The button label morphing is a cheap, effective ambient signal of pending state.
- Keyboard: `F` toggles the file tree, `S` shows the stack; comments in the timeline scroll the related change into view.
- Sidebar: a right-hand timeline panel is on by default but fully dismissible into "Focus Mode" - persistent context is offered, never forced.

### Gerrit

Source: [Review UI documentation](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html).

- Anchoring: line or selected range; ranges are highlighted in yellow.
- Batching: comments are drafts until the Reply popup publishes drafts, a summary, and label votes in one send.
- Keyboard: the strongest keyboard model surveyed - select text and press `c` to comment, `?` shows all shortcuts, vim-like file navigation.
  Reviewing an entire change without touching the mouse is realistic.

### Reviewable

Source: [Reviews documentation](https://docs.reviewable.io/reviews.html).

- Batching: everything autosaves as invisible drafts; one Publish button emits comments, review marks, and dispositions as a single combined message.
- Dispositions: every discussion carries an explicit state (To reply / Unresolved / Resolved), which makes triage tractable in long reviews.
- Anchoring across revisions: comments track file positions across pushed revisions via a file-by-revision matrix.
  The matrix is powerful but famously dense; it front-loads a lot of UI complexity for a capability most sessions never need.
- Interop hazard: mixing Reviewable and GitHub reviews on the same PR corrupts state expectations - split-brain review state across two surfaces is a known failure mode.

### Google Docs (comments + suggesting mode)

Source: [Suggest edits in Google Docs](https://support.google.com/docs/answer/6033474).

- Anchoring: character-span on rich text for both comments and suggestions.
- Edit vs comment: three explicit document modes - Editing, Suggesting, Viewing.
  Suggesting renders edits as tracked changes ("your change in a new color, anything you delete will be crossed out") with per-change Accept/Reject, plus bulk review via Tools > Review suggested edits with a preview of the accepted result.
- Coexistence: comments and suggestions are separate but composable - a suggestion thread accepts replies, so discussion attaches to a proposed edit.
  This is the cleanest existing answer to cueloop's plan-view question of how select-a-span annotation and direct edit mode coexist: same anchoring model, different verb, explicit mode switch.

### Notion

Source: [Comments, mentions & reactions](https://www.notion.com/help/comments-mentions-and-reminders), [Notion 2.12 release](https://www.notion.com/releases/2021-09-21).

- Anchoring: text-span within a block, or whole-block via the block handle; `cmd/ctrl+shift+M` comments on the current selection or cursor position.
- Sidebar: an on-demand right sidebar aggregates all page comments with an Open/Resolved toggle; it is not persistent by default.
- API note: Notion's public API cannot create span-anchored comments, only block-level ones - a reminder that span anchoring needs first-class data-model support or it gets lost at the API boundary.

### Figma

Source: [Add comments to files](https://help.figma.com/hc/en-us/articles/360039825314-Add-comments-to-files).

- Anchoring: pins on canvas points or regions.
- Mode: `C` enters comment mode; a single key flips the whole interaction grammar of the cursor.
- The limitation: "when you're in comment mode, you won't be able to make any changes to objects in the canvas".
  Modal separation keeps each mode simple, but hard mode exclusivity forces constant toggling when review naturally interleaves reading, commenting, and small fixes.
- Sidebar: comment list in a right sidebar with sort, filter, resolve, and reactions - useful because canvas pins have no reading order, so the list supplies one.
  A markdown document already has a reading order, which weakens the case for the same persistent list in cueloop.

### Overleaf track changes

Source: [Track changes](https://docs.overleaf.com/collaborating/track-changes).

- A dedicated "Reviewing mode" in the editor toolbar turns edits into tracked changes shown inline.
- Accept/reject operates on selections: select any region (or the whole document) and accept or reject all changes inside it - a nice middle ground between per-change and all-or-nothing.
- Comments coexist with tracked changes and can be replied to, resolved (archived), or deleted.

### iA Writer and Typora (edit vs preview)

Source: [Typora](https://typora.io/), [iA Writer preview](https://ia.net/writer/support/preview/modify-preview).

Two philosophies for the same problem cueloop's plan view has:

- Typora: one surface, live-rendered; markdown formatting resolves in place as you type, no separate preview.
- iA Writer: two surfaces; a plain-text editor with an optional side-by-side or full-screen rendered preview.

For cueloop, the reviewer's primary surface should be the rendered document (Typora-style reading experience), with direct edit as a mode on that same surface rather than a split pane - a reviewer switching to a raw-markdown split view loses the annotations' visual context.

### Hypothesis / W3C Web Annotation (anchoring model)

Source: [Fuzzy Anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/).

The strongest prior art for span anchoring that survives document edits.
Each annotation target is stored as three selectors: a RangeSelector (structural), a TextPositionSelector (character offsets), and a TextQuoteSelector (the quoted text plus 32 characters of surrounding context).
Re-anchoring tries strategies in order, falling back to fuzzy matching on the quote; annotations "withstand document changes (both structure and content)".
Directly relevant to cueloop: when the agent revises a plan, span annotations should re-anchor by quote-plus-context rather than dying with their character offsets.
Known cost: fuzzy matching short generic quotes in long documents is slow, so store all three selectors and only fall back when the cheap ones miss.

## Shortlist: patterns cueloop should adopt

1. GitHub/Gerrit-style atomic review submission: pending annotations invisible to the agent until one submit publishes annotations, summary, and verdict together.
   This is cueloop's planned model and every serious code-review tool independently converged on it; keep the verdict choice inside the submit step, not as a separate control.
2. Hypothesis-style triple-selector span anchoring (quote + context, position, structural path) for plan-view annotations, so feedback survives agent-side plan revisions and can be quoted verbatim in the structured feedback payload.
3. Google Docs' mode triad for the plan view: read/annotate as default, direct-edit as an explicit mode, with direct edits rendered as tracked changes the agent receives as an unambiguous diff rather than a mutated document.
4. Gerrit/Graphite keyboard grammar: select-then-`c` to annotate, `n`/`p` between pending annotations, `?` for the cheat sheet, and Graphite's morphing "finish review (n)" button as the ambient pending-count signal.
5. GitHub's viewed-file progress with staleness invalidation for the file/diff view: per-file viewed checkbox, header progress bar, and automatic "changed since last view" revocation when a resubmission touches a viewed file.

On the open sidebar question: the evidence favors summary-on-submit plus an on-demand pending-annotation list over a persistent sidebar.
GitHub ships no persistent sidebar and its main reported pain is only relocating pending comments; Graphite makes its sidebar dismissible; Notion's is on-demand.
Figma's persistent list earns its place only because canvas pins lack reading order - cueloop's documents have one.
Recommendation: pending count in the header, a toggleable (not default-open) annotation list, and the full summary at submit time.

## Patterns to deliberately avoid

- Figma-style hard mode exclusivity where comment mode blocks all editing; annotate should be the default state, with edit as the explicit exception, never a lockout.
- Reviewable's file-by-revision matrix as a primary surface; per-session review with one artifact version at a time does not need it, and it is the most-cited source of Reviewable's intimidation factor.
- Split-brain review state across surfaces (the Reviewable-vs-GitHub hazard); cueloop's session must be the single source of truth for annotation and verdict state.
- Draft state with no ambient indicator; invisible-until-submit is right for the agent, wrong for the reviewer, so always show the pending count.
- Bulk accept-all for direct edits without a preview of the result; Google Docs pairs accept-all with a preview, and Overleaf scopes accept/reject to a selection - keep one of those guardrails.
- Raw-markdown split-pane as the review surface (iA Writer-style); reviewers should read the rendered plan, since a split pane divorces annotations from their visual anchors.
