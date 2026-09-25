---
name: prototype
description: >-
  Submit a component design proposal to cueloop for human review without blocking.
  Use when the user asks to review a UI component's shape before implementing it:
  its prop/type API, composition, and callstack.
---

# cueloop prototype review

Review a UI component on paper before you build it: its interface, how it is
assembled from primitives you already have, and its callstack. You write a single
Markdown design doc; the reviewer reads it in the terminal and annotates the exact
lines. The review does not block: you submit, keep working with the user, and
cueloop delivers the Message when the reviewer is done.

Write the doc as plain Markdown with exactly these three sections, in order. Keep
everything line-addressable text, since the reviewer anchors comments to lines and
words. Prefer fenced code blocks and indented trees over prose. Do not use Markdown
tables; the reviewer renders one as a single block, so write comparisons as a list.

## 1. API

The prop/type surface, as a fenced `ts` block: the real interface a caller sees.
Extract it from the component's types, or write the proposed one. Include every
prop, its type, whether it is optional, and a one-line intent where it is not
obvious.

## 2. Composition

How the component is assembled, as a **JSX anatomy tree** in a fenced `tsx` block,
following the react-aria / Radix "Anatomy" convention. Write the real element tree,
nesting by indentation, and put a trailing `{/* ... */}` comment on a node to name
the primitive it reuses (or mark it a slot). It reads as code, so the reviewer
annotates actual JSX lines. When there is more than one way to build it, list the
options and your recommendation as a list, not a table:

```tsx
<ComboBox>              {/* generic over T */}
  <Label />
  <Group>
    <Input />           {/* reuse: Input */}
    <Button />          {/* toggle the popover */}
  </Group>
  <Popover>             {/* reuse: Popover, focus-trap + esc */}
    <ListBox>
      <ListBoxItem />   {/* active / selected */}
    </ListBox>
  </Popover>
</ComboBox>
```

Options considered:
- **A, reuse the shared Popover**: focus-trap and escape-to-close come for free; least new code.
- **B, a bespoke popover**: full control of placement, but it re-solves focus management.

Recommendation: A. Reuse the Popover and keep the ComboBox to input + listbox wiring.

## 3. Callstack

The call and data flow through the component, as an indented tree in a fenced block:
entry point at the top, each call nested one level deeper, down to the store or
output. Designing this flow up front is the point of the review. It shows how a
user action threads through the layers before any code exists.

```
main.ts
  Command.runWith(rootCommand)
    cli.ts  alias command handler
      parseLinkSlug("gh")
      parseDestinationUrl("https://example.com/acme")
      LinkManagerClient.alias({ slug, destination })
        HttpApiClient client.operator.createAlias({ params, payload })
          PUT {baseUrl}/api/links/gh
            Access middleware
            ProvideOperatorIdentity middleware
            OperatorHandlers.createAlias
              LinkCatalog.getLink(slug)
              LinkCatalog.createAlias({ slug, destination, operator })
                LinkCatalogStore.insertAlias
                RedirectIndexService.putDestination
      CliOutput.link(link)
```

## Submit and respond

Write the doc to one Markdown file and submit it through the harness's cueloop
`prototype` workflow when available. Otherwise, run
`cueloop session create --type prototype --content-file <design.md>` and give
the user the returned Thread ID. On the CLI path, collect the Message with
`cueloop session wait <id> --timeout-ms 60000`, repeating while pending.

On approval, proceed with the component. When changes are requested, apply
every edited line and annotation to the design doc, then revise the same
Thread with `cueloop session submit-revision <id> --content-file <design.md>`
on the CLI path.

Reviewing a rendered pixel mockup instead of a design doc is an opt-in
experimental mode, set by the `[experimental]` config section. It needs a
graphics-capable terminal and an installed browser.
