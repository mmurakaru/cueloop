/**
 * Throwaway prototype: how mixed author/collaborator annotations read in the
 * review rail once a shared plan comes back with other people's notes.
 * Three treatments, h/l to switch, q to quit. Not wired to anything real.
 */

import React, { useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { DARK } from "../../packages/client/src/theme";

interface Note {
  kind: "comment" | "suggestion";
  quote: string;
  body: string;
  author: string; // "you" for the planner
  anonymous?: boolean;
}

// distinct accent per person, so the same author reads consistently
const AUTHOR_COLOR: Record<string, string> = {
  you: DARK.accent,
  alex: DARK.blue,
  anonymous: DARK.textDim,
};

const NOTES: Note[] = [
  { kind: "comment", quote: "those annotations flow back to the planner", body: "worth sketching the expected flow as a diagram", author: "you" },
  { kind: "suggestion", quote: "Oracle Cloud Always-Free ARM VM", body: "check for a provisioning CLI so setup is scriptable", author: "alex" },
  { kind: "comment", quote: "default 30 days", body: "30 feels right for a real review cycle", author: "alex" },
  { kind: "comment", quote: "accept-any-key SSH auth", body: "does the fingerprint leak anything? double-check", author: "anonymous", anonymous: true },
];

function kindColor(kind: Note["kind"]): string {
  return kind === "suggestion" ? DARK.green : DARK.accent;
}

function authorLabel(note: Note): string {
  return note.anonymous ? "anonymous" : note.author;
}

/**
 * A - the author's name IS the border title, reusing the agent-note box
 * pattern (where the border reads " agent note "). Border color per author;
 * gray for anonymous, exactly like the gray agent-note block. No inline tag.
 */
function VariantNameInBorder(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column" }}>
      {NOTES.map((note, index) => {
        const color = note.author === "you" ? DARK.border : (AUTHOR_COLOR[note.author] ?? DARK.textDim);
        return (
          <box
            key={index}
            title={` ${authorLabel(note)} `}
            style={{ flexDirection: "column", border: true, borderStyle: "rounded", borderColor: color, marginBottom: 1, paddingLeft: 1, paddingRight: 1 }}
          >
            <text>
              <span fg={kindColor(note.kind)}>{note.kind.toUpperCase()}</span>
              <span fg={DARK.textDim}>{` "${note.quote}"`}</span>
            </text>
            <text fg={DARK.text}>{note.body}</text>
          </box>
        );
      })}
    </box>
  );
}

/** B - a colored author gutter + initial badge; author name in the header row. */
function VariantAuthorGutter(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column" }}>
      {NOTES.map((note, index) => {
        const color = AUTHOR_COLOR[note.author] ?? DARK.textDim;
        const initial = note.anonymous ? "?" : note.author[0]!.toUpperCase();
        return (
          <box key={index} style={{ flexDirection: "row", marginBottom: 1 }}>
            <box style={{ width: 3, backgroundColor: color }}>
              <text fg={DARK.accentInk}>{` ${initial} `}</text>
            </box>
            <box style={{ flexDirection: "column", flexGrow: 1, border: true, borderStyle: "rounded", borderColor: DARK.border, paddingLeft: 1, paddingRight: 1 }}>
              <text>
                <span fg={kindColor(note.kind)}>{note.kind.toUpperCase()}</span>
                <span fg={DARK.textDim}> · </span>
                <span fg={color}>{authorLabel(note)}</span>
              </text>
              <text fg={DARK.textDim}>{`"${note.quote}"`}</text>
              <text fg={DARK.text}>{note.body}</text>
            </box>
          </box>
        );
      })}
    </box>
  );
}

/** C - grouped by author, a header per person then their cards. */
function VariantGrouped(): React.ReactNode {
  const authors = [...new Set(NOTES.map((note) => note.author))];
  return (
    <box style={{ flexDirection: "column" }}>
      {authors.map((author) => {
        const color = AUTHOR_COLOR[author] ?? DARK.textDim;
        const notes = NOTES.filter((note) => note.author === author);
        return (
          <box key={author} style={{ flexDirection: "column", marginBottom: 1 }}>
            <text>
              <span fg={color}>{author === "you" ? "You" : authorLabel(notes[0]!)}</span>
              <span fg={DARK.textDim}>{`  (${notes.length})`}</span>
            </text>
            {notes.map((note, index) => (
              <box key={index} style={{ flexDirection: "column", paddingLeft: 2 }}>
                <text>
                  <span fg={kindColor(note.kind)}>{note.kind.toUpperCase()}</span>
                  <span fg={DARK.textDim}>{` "${note.quote}"`}</span>
                </text>
                <text fg={DARK.text}>{`  ${note.body}`}</text>
              </box>
            ))}
          </box>
        );
      })}
    </box>
  );
}

const VARIANTS = [
  { name: "A · name in border (agent-note style)", render: VariantNameInBorder },
  { name: "B · author gutter + initial", render: VariantAuthorGutter },
  { name: "C · grouped by author", render: VariantGrouped },
];

function App({ onExit }: { onExit: () => void }): React.ReactNode {
  const [index, setIndex] = useState(0);
  useKeyboard((key) => {
    if (key.name === "q") onExit();
    else if (key.name === "l" || key.name === "right") setIndex((current) => (current + 1) % VARIANTS.length);
    else if (key.name === "h" || key.name === "left") setIndex((current) => (current - 1 + VARIANTS.length) % VARIANTS.length);
  });
  const variant = VARIANTS[index]!;
  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: DARK.bg }}>
      <box style={{ height: 1, backgroundColor: DARK.panel, paddingLeft: 1 }}>
        <text>
          <span fg={DARK.accent}>attribution ui</span>
          <span fg={DARK.textDim}>{`  ·  ${variant.name}  (${index + 1}/${VARIANTS.length})`}</span>
        </text>
      </box>
      <box style={{ flexDirection: "row", flexGrow: 1, padding: 1 }}>
        <box style={{ width: 44, flexDirection: "column" }}>{variant.render()}</box>
      </box>
      <box style={{ height: 1, backgroundColor: DARK.panel, paddingLeft: 1 }}>
        <text fg={DARK.textDim}>h/l switch treatment · q quit</text>
      </box>
    </box>
  );
}

if (import.meta.main) {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(
    <App
      onExit={() => {
        renderer.destroy();
        queueMicrotask(() => process.exit(0));
      }}
    />,
  );
}
