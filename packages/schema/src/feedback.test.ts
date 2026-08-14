import { describe, expect, test } from "bun:test";
import { renderFeedback } from "./feedback";
import type { Annotation } from "./types";

const PLAN = `# Plan

## Context

Review sessions live only in daemon memory today.

## Storage

Sessions are written as one JSON document per session.
`;

function makeAnnotation(partial: Partial<Annotation> & { anchor: Annotation["anchor"] }): Annotation {
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
    // Act
    const feedback = renderFeedback({
      verdictKind: "request_changes",
      summary: "Tighten the storage section.",
      artifactContent: PLAN,
      workingCopy: PLAN.replace("one JSON document", "one JSON record"),
      annotations: [],
      planPath: "docs/plan.md",
    });

    // Assert
    expect(feedback).toContain("# Review: request changes");
    expect(feedback).toContain("Tighten the storage section.");
    expect(feedback).toContain("## Plan edits");
    expect(feedback).toContain("Apply this exact diff first");
    expect(feedback).toContain("--- a/docs/plan.md");
    expect(feedback).toContain("-Sessions are written as one JSON document per session.");
    expect(feedback).toContain("+Sessions are written as one JSON record per session.");
  });

  test("annotations are located by quote and section", () => {
    // Act
    const feedback = renderFeedback({
      verdictKind: "comment",
      summary: "",
      artifactContent: PLAN,
      annotations: [
        makeAnnotation({
          anchor: { quote: "daemon memory", prefix: "live only in ", suffix: " today." },
        }),
      ],
    });

    // Assert
    expect(feedback).toContain("## Annotations (1)");
    expect(feedback).toContain("### 1. Comment (§ Context)");
    expect(feedback).toContain("> daemon memory");
    expect(feedback).toContain("Please clarify.");
  });

  test("suggestions render as replace/with pairs", () => {
    // Act
    const feedback = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: PLAN,
      annotations: [
        makeAnnotation({
          kind: "suggestion",
          body: "one durable JSON record",
          anchor: { quote: "one JSON document", prefix: "written as ", suffix: " per session." },
        }),
      ],
    });

    // Assert
    expect(feedback).toContain("### 1. Suggested change (§ Storage)");
    expect(feedback).toContain("Replace:\n> one JSON document");
    expect(feedback).toContain("With:\n> one durable JSON record");
  });

  test("orphaned anchors are flagged, never dropped", () => {
    // Act
    const feedback = renderFeedback({
      verdictKind: "comment",
      summary: "",
      artifactContent: PLAN,
      annotations: [makeAnnotation({ anchor: { quote: "text that is gone", prefix: "", suffix: "" } })],
    });

    // Assert
    expect(feedback).toContain("[orphaned anchor: the quoted text is no longer present]");
    expect(feedback).toContain("> text that is gone");
  });

  test("empty review says so explicitly", () => {
    // Act
    const feedback = renderFeedback({
      verdictKind: "approve",
      summary: "",
      artifactContent: PLAN,
      annotations: [],
    });

    // Assert
    expect(feedback).toContain("_No edits or annotations._");
  });

  test("agent notes never come back as feedback items", () => {
    // Arrange
    const note = makeAnnotation({
      kind: "note",
      anchor: { quote: "src/a.ts", prefix: "", suffix: "" },
      body: "The agent's own explanation of the change.",
    });

    // Act
    const noteOnly = renderFeedback({ verdictKind: "approve", summary: "", artifactContent: PLAN, annotations: [note] });

    // Assert
    expect(noteOnly).toContain("_No edits or annotations._");
    expect(noteOnly).not.toContain("The agent's own explanation of the change.");
    const mixed = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: PLAN,
      annotations: [note, makeAnnotation({ anchor: { quote: "one JSON document", prefix: "written as ", suffix: " per session." } })],
    });
    expect(mixed).toContain("## Annotations (1)");
    expect(mixed).not.toContain("The agent's own explanation of the change.");
  });

  test("anchors resolve against the working copy when present", () => {
    // Arrange
    // annotation made on text that only exists in the edited copy
    const working = PLAN.replace("## Storage", "## Persistence");

    // Act
    const feedback = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: PLAN,
      workingCopy: working,
      annotations: [
        makeAnnotation({ anchor: { quote: "one JSON document", prefix: "written as ", suffix: " per session." } }),
      ],
    });

    // Assert
    expect(feedback).toContain("(§ Persistence)");
  });
});
