import { describe, expect, test } from "bun:test";
import { renderFeedback } from "./feedback";
import type { Annotation } from "./types";

const PLAN = `# Plan

## Context

Review sessions live only in daemon memory today.

## Storage

Sessions are written as one JSON document per session.
`;

function ann(partial: Partial<Annotation> & { anchor: Annotation["anchor"] }): Annotation {
  return {
    id: "a1",
    kind: "comment",
    body: "Please clarify.",
    createdAt: "2026-08-07T00:00:00.000Z",
    ...partial,
  };
}

describe("renderFeedback", () => {
  test("plan edits section carries the one unified diff, directive framing first", () => {
    const out = renderFeedback({
      verdictKind: "request_changes",
      summary: "Tighten the storage section.",
      artifactContent: PLAN,
      workingCopy: PLAN.replace("one JSON document", "one JSON record"),
      annotations: [],
      planPath: "docs/plan.md",
    });
    expect(out).toContain("# Review: request changes");
    expect(out).toContain("Tighten the storage section.");
    expect(out).toContain("## Plan edits");
    expect(out).toContain("Apply this exact diff first");
    expect(out).toContain("--- a/docs/plan.md");
    expect(out).toContain("-Sessions are written as one JSON document per session.");
    expect(out).toContain("+Sessions are written as one JSON record per session.");
  });

  test("annotations are located by quote and section", () => {
    const out = renderFeedback({
      verdictKind: "comment",
      summary: "",
      artifactContent: PLAN,
      annotations: [
        ann({
          anchor: { quote: "daemon memory", prefix: "live only in ", suffix: " today." },
        }),
      ],
    });
    expect(out).toContain("## Annotations (1)");
    expect(out).toContain("### 1. Comment (§ Context)");
    expect(out).toContain("> daemon memory");
    expect(out).toContain("Please clarify.");
  });

  test("suggestions render as replace/with pairs", () => {
    const out = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: PLAN,
      annotations: [
        ann({
          kind: "suggestion",
          body: "one durable JSON record",
          anchor: { quote: "one JSON document", prefix: "written as ", suffix: " per session." },
        }),
      ],
    });
    expect(out).toContain("### 1. Suggested change (§ Storage)");
    expect(out).toContain("Replace:\n> one JSON document");
    expect(out).toContain("With:\n> one durable JSON record");
  });

  test("orphaned anchors are flagged, never dropped", () => {
    const out = renderFeedback({
      verdictKind: "comment",
      summary: "",
      artifactContent: PLAN,
      annotations: [ann({ anchor: { quote: "text that is gone", prefix: "", suffix: "" } })],
    });
    expect(out).toContain("[orphaned anchor: the quoted text is no longer present]");
    expect(out).toContain("> text that is gone");
  });

  test("empty review says so explicitly", () => {
    const out = renderFeedback({
      verdictKind: "approve",
      summary: "",
      artifactContent: PLAN,
      annotations: [],
    });
    expect(out).toContain("_No edits or annotations._");
  });

  test("agent notes never come back as feedback items", () => {
    const note = ann({
      kind: "note",
      anchor: { quote: "src/a.ts", prefix: "", suffix: "" },
      body: "The agent's own explanation of the change.",
    });
    const noteOnly = renderFeedback({ verdictKind: "approve", summary: "", artifactContent: PLAN, annotations: [note] });
    expect(noteOnly).toContain("_No edits or annotations._");
    expect(noteOnly).not.toContain("The agent's own explanation of the change.");
    const mixed = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: PLAN,
      annotations: [note, ann({ anchor: { quote: "one JSON document", prefix: "written as ", suffix: " per session." } })],
    });
    expect(mixed).toContain("## Annotations (1)");
    expect(mixed).not.toContain("The agent's own explanation of the change.");
  });

  test("anchors resolve against the working copy when present", () => {
    // annotation made on text that only exists in the edited copy
    const working = PLAN.replace("## Storage", "## Persistence");
    const out = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: PLAN,
      workingCopy: working,
      annotations: [
        ann({ anchor: { quote: "one JSON document", prefix: "written as ", suffix: " per session." } }),
      ],
    });
    expect(out).toContain("(§ Persistence)");
  });
});
