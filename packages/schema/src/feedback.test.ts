import { describe, expect, test } from "bun:test";
import { renderFeedback } from "./feedback";
import type { Annotation } from "./types";

const PLAN = `# Plan

## Context

Review sessions live only in daemon memory today.

## Storage

Sessions are written as one JSON document per session.
`;

function makeAnnotation(
  partial: Partial<Annotation> & { anchor: Annotation["anchor"] },
): Annotation {
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
      artifactPath: "docs/plan.md",
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

  test("reply edits section is labelled for the reply artifact, not a plan", () => {
    // Act
    const feedback = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: PLAN,
      workingCopy: PLAN.replace("one JSON document", "one JSON record"),
      artifactType: "reply",
      annotations: [],
      artifactPath: "reply.md",
    });

    // Assert
    expect(feedback).toContain("## Reply edits");
    expect(feedback).not.toContain("## Plan edits");
    expect(feedback).toContain("Apply this exact diff first");
  });

  test("a reply review with no artifact path references reply.md, never plan.md", () => {
    // Act
    const feedback = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: "# Findings\n\nThe cache is fine.\n",
      artifactType: "reply",
      annotations: [
        makeAnnotation({ anchor: { quote: "The cache is fine.", prefix: "", suffix: "" } }),
      ],
      sessionId: "ses_reply",
    });

    // Assert
    expect(feedback).toContain("Locate each one in reply.md");
    expect(feedback).toContain("submit-revision ses_reply --content-file reply.md");
    expect(feedback).not.toContain("plan.md");
  });

  test("a diff working copy is handed back as the curated patch, not a diff of diffs", () => {
    // Arrange
    const submittedPatch = `--- a/src/x.ts
+++ b/src/x.ts
@@ -1,1 +1,1 @@
-const limit = 100;
+const limit = 250;
`;
    const curatedPatch = `--- a/src/x.ts
+++ b/src/x.ts
@@ -1,1 +1,1 @@
-const limit = 100;
+const limit = 175;
`;

    // Act
    const feedback = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: submittedPatch,
      workingCopy: curatedPatch,
      artifactType: "diff",
      annotations: [],
    });

    // Assert
    expect(feedback).toContain("## Curated changes");
    expect(feedback).toContain("+const limit = 175;");
    // the submitted patch is not re-diffed against the curated one
    expect(feedback).not.toContain("Plan edits");
    expect(feedback).not.toContain("++const");
  });

  test("a diff working copy that rejected everything says so", () => {
    // Act
    const feedback = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n",
      workingCopy: "",
      artifactType: "diff",
      annotations: [],
    });

    // Assert
    expect(feedback).toContain("## Curated changes");
    expect(feedback).toContain("rejected all of your proposed changes");
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

  test("a discussion renders as one item: the root comment, then its replies in order", () => {
    // Arrange: a root, a later reply, an earlier reply, and a reply whose root is gone
    const anchor = { quote: "daemon memory", prefix: "live only in ", suffix: " today." };

    // Act
    const feedback = renderFeedback({
      verdictKind: "comment",
      summary: "",
      artifactContent: PLAN,
      annotations: [
        makeAnnotation({ id: "root", anchor, body: "Which daemon?" }),
        makeAnnotation({
          id: "late",
          anchor,
          body: "The local one, I think.",
          replyTo: "root",
          createdAt: "2026-08-07T00:02:00.000Z",
        }),
        makeAnnotation({
          id: "early",
          anchor,
          body: "Worth stating in the plan.",
          replyTo: "root",
          author: "SHA256:ana",
          createdAt: "2026-08-07T00:01:00.000Z",
        }),
        makeAnnotation({ id: "stray", anchor, body: "Standalone.", replyTo: "gone" }),
      ],
    });

    // Assert: two items, replies listed under the root by time
    expect(feedback).toContain("## Annotations (2)");
    expect(feedback).toContain(
      "Which daemon?\n\nReplies:\n\n- Worth stating in the plan.\n- The local one, I think.\n\nannotation id: `root`",
    );
    expect(feedback).toContain("### 2. Comment");
    expect(feedback).toContain("Standalone.");
    expect(feedback).not.toContain("annotation id: `late`");
  });

  test("a reply whose root was addressed leaves the document with it", () => {
    // Arrange: the root is addressed, its reply is not marked, a stray reply's root is unknown
    const anchor = { quote: "daemon memory", prefix: "live only in ", suffix: " today." };

    // Act
    const feedback = renderFeedback({
      verdictKind: "comment",
      summary: "",
      artifactContent: PLAN,
      annotations: [
        makeAnnotation({
          id: "root",
          anchor,
          body: "Which daemon?",
          resolution: { revision: 2, source: "agent" },
        }),
        makeAnnotation({ id: "reply", anchor, body: "The local one.", replyTo: "root" }),
        makeAnnotation({ id: "stray", anchor, body: "Standalone.", replyTo: "gone" }),
      ],
    });

    // Assert: only the stray reply remains, as its own item
    expect(feedback).toContain("## Annotations (1)");
    expect(feedback).not.toContain("The local one.");
    expect(feedback).toContain("Standalone.");
  });

  test("orphaned anchors are flagged, never dropped", () => {
    // Act
    const feedback = renderFeedback({
      verdictKind: "comment",
      summary: "",
      artifactContent: PLAN,
      annotations: [
        makeAnnotation({ anchor: { quote: "text that is gone", prefix: "", suffix: "" } }),
      ],
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
    const noteOnly = renderFeedback({
      verdictKind: "approve",
      summary: "",
      artifactContent: PLAN,
      annotations: [note],
    });

    // Assert
    expect(noteOnly).toContain("_No edits or annotations._");
    expect(noteOnly).not.toContain("The agent's own explanation of the change.");
    const mixed = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactContent: PLAN,
      annotations: [
        note,
        makeAnnotation({
          anchor: { quote: "one JSON document", prefix: "written as ", suffix: " per session." },
        }),
      ],
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
        makeAnnotation({
          anchor: { quote: "one JSON document", prefix: "written as ", suffix: " per session." },
        }),
      ],
    });

    // Assert
    expect(feedback).toContain("(§ Persistence)");
  });

  test("a prototype annotation locates by its selector and is never orphan-flagged", () => {
    // Act
    const feedback = renderFeedback({
      verdictKind: "request_changes",
      summary: "",
      artifactType: "prototype",
      artifactContent: "<main><div class='card'>Pricing</div></main>",
      annotations: [
        makeAnnotation({
          body: "Tighten the padding.",
          anchor: { quote: "Pricing", prefix: "", suffix: "", selector: "main > div.card" },
        }),
      ],
      artifactPath: "proto.html",
    });

    // Assert
    expect(feedback).toContain("(main > div.card)");
    expect(feedback).toContain("Tighten the padding.");
    expect(feedback).toContain("by its CSS selector");
    expect(feedback).not.toContain("orphaned anchor");
  });
});
