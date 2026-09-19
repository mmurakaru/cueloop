#!/usr/bin/env bun
/**
 * Landing snapshot seeder: a component design doc (the default markdown prototype)
 * carrying the reviewer's own note and a collaborator's, anchored to lines inside
 * the API and Composition sections. Opens the real TUI; captured from a real
 * ghostty window. Isolated home under /tmp.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { runClient } from "@cueloop/client";
import { makeAnchor, parseBlocks } from "@cueloop/schema";

const home = mkdtempSync(join(tmpdir(), "cueloop-snapshot-prototype-"));
const server = new DaemonServer({ home, idleExitMs: 0 });
server.start();

const DOC = `# Combobox

## API

\`\`\`ts
interface ComboBoxProps<T> {
  items?: Iterable<T>
  inputValue?: string
  onInputChange?: (value: string) => void
  selectedKey?: Key | null
  onSelectionChange?: (key: Key | null) => void
  allowsCustomValue?: boolean
  menuTrigger?: 'focus' | 'input' | 'manual'
}
\`\`\`

## Composition

\`\`\`tsx
<ComboBox>              {/* generic over T */}
  <Label />
  <Group>
    <Input />           {/* reuse: Input */}
    <Button />          {/* toggle the popover */}
  </Group>
  <Popover>             {/* reuse: Popover */}
    <ListBox>
      <ListBoxItem />   {/* active / selected */}
    </ListBox>
  </Popover>
</ComboBox>
\`\`\`

## Callstack

\`\`\`
ComboBox
  useComboBoxState({ items, defaultFilter })
    onInputChange(query)
      collection.filter(query)
    onKeyDown("Enter")
      state.commit(key)
        onSelectionChange(key)
\`\`\`
`;

const session = server.core.sessionCreate({
  workspace: { repoRoot: process.cwd(), branch: "combobox" },
  artifact: {
    type: "prototype",
    content: DOC,
    meta: { title: "Combobox", agent: "pi" },
  },
});

const blocks = parseBlocks(DOC);
const anchorFor = (needle: string) => {
  const blockIndex = blocks.findIndex((block) => block.text.includes(needle));
  const start = blocks[blockIndex]!.text.indexOf(needle);

  return makeAnchor(blocks, blockIndex, start, start + needle.length);
};

// the reviewer's own note on the API - no author, so the rail tags it "me"
server.core.sessionAnnotate(session.id, {
  id: "own_1",
  kind: "comment",
  anchor: anchorFor("allowsCustomValue?: boolean"),
  body: "restrict to items, or allow a custom typed value?",
});

// a collaborator with a lowercase handle (renders "nelson")
server.core.sessionMergeShared(session.id, {
  annotations: [
    {
      id: "collab_nelson",
      kind: "comment",
      anchor: anchorFor("<Popover>             {/* reuse: Popover */}"),
      body: "reuse the existing Popover so focus-trap + escape come for free.",
      author: "nelson",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
});

console.log(`seeded ${session.id}`);
await runClient({ home, sessionId: session.id });
server.stop();
