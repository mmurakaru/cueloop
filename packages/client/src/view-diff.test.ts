import { describe, expect, test } from "bun:test";
import { makeAnchor, type Annotation, type Thread } from "@cueloop/schema";
import {
  changesMarks,
  diffRowAnchor,
  diffRowBlocks,
  diffRows,
  fileRowRange,
  fileTargetMarks,
} from "./view-diff";

const PATCH = `diff --git a/src/store.ts b/src/store.ts
index 111..222 100644
--- a/src/store.ts
+++ b/src/store.ts
@@ -1,5 +1,6 @@
 import { join } from "node:path";
 export class Store {
-  private items = [];
+  private items = new Map();
+  private ready = false;
   constructor() {}
@@ -20,3 +21,3 @@
 export function helper() {
-  return 1;
+  return 2;
 }
`;

describe("diffRows", () => {
  test("flattens files, hunks, and signed lines with line numbers", () => {
    // Act
    const rows = diffRows(PATCH);

    // Assert
    expect(rows[0]).toMatchObject({ kind: "file", file: "src/store.ts" });
    expect(rows[1]!.kind).toBe("hunk");
    const del = rows.find((row) => row.kind === "del")!;

    expect(del.text).toContain("private items = [];");
    expect(del.oldLine).toBe(3);
    const adds = rows.filter((row) => row.kind === "add");

    expect(adds[0]!.text).toContain("new Map()");
    expect(adds[0]!.newLine).toBe(3);
    expect(adds[1]!.newLine).toBe(4);
    // two hunks
    expect(rows.filter((row) => row.kind === "hunk").length).toBe(2);
  });

  test("context lines carry both line numbers", () => {
    // Act
    const rows = diffRows(PATCH);

    // Assert
    const ctx = rows.find((row) => row.kind === "ctx")!;

    expect(ctx.oldLine).toBe(1);
    expect(ctx.newLine).toBe(1);
  });
});

describe("diffRowAnchor", () => {
  test("quote is the line, neighbors are the context selectors", () => {
    // Arrange
    const rows = diffRows(PATCH);
    const rowIndex = rows.findIndex((row) => row.text.includes("new Map()"));

    // Act
    const anchor = diffRowAnchor(rows, rowIndex);

    // Assert
    expect(anchor.quote).toContain("new Map()");
    expect(anchor.prefix.length).toBeGreaterThan(0);
    expect(anchor.suffix.length).toBeGreaterThan(0);
  });
});

describe("fileTargetMarks", () => {
  // two files whose added line is byte-identical; a note on one must never mark the other
  const TWO_FILE = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 const keep = 0;
+const dup = 1;
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,2 @@
 const keep = 0;
+const dup = 1;
`;

  test("a file-target note marks only its own file, never identical text in another", () => {
    // Arrange - anchor the added line inside a.ts, file-relative like the controller does
    const rows = diffRows(TWO_FILE);
    const range = fileRowRange(rows, "a.ts")!;
    const fileRows = rows.slice(range.start, range.end);
    const addRelative = fileRows.findIndex((row) => row.kind === "add");
    const quote = fileRows[addRelative]!.text.replace(/\n$/, "");
    const anchor = makeAnchor(diffRowBlocks(fileRows), addRelative, 0, quote.length, addRelative);
    const annotation: Annotation = {
      id: "a1",
      kind: "comment",
      anchor,
      target: { kind: "file", path: "a.ts", rev: "worktree" },
      body: "note",
      createdAt: "2026-01-01T00:00:00Z",
    };

    // Act
    const marked = [...fileTargetMarks([annotation], rows).keys()];

    // Assert - every marked row sits inside a.ts's range, and b.ts's identical line is untouched
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every((index) => index >= range.start && index < range.end)).toBe(true);
  });
});

describe("changesMarks", () => {
  const PATCH = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,2 @@
 const keep = 0;
+const added = 1;
`;

  function diffThread(meta: Thread["artifact"]["meta"], annotations: Annotation[]): Thread {
    return {
      schemaVersion: "1",
      id: "s_changes",
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "diff", content: PATCH, meta },
      revisions: [{ revision: 1, content: PATCH, submittedAt: "2026-01-01T00:00:00Z" }],
      annotations,
      message: null,
      status: "pending",
      createdAt: "2026-01-01T00:00:00Z",
    };
  }

  function fileNote(rows: ReturnType<typeof diffRows>): Annotation {
    const range = fileRowRange(rows, "x.ts")!;
    const fileRows = rows.slice(range.start, range.end);
    const addRelative = fileRows.findIndex((row) => row.kind === "add");
    const quote = fileRows[addRelative]!.text.replace(/\n$/, "");
    const anchor = makeAnchor(diffRowBlocks(fileRows), addRelative, 0, quote.length, addRelative);

    return {
      id: "f1",
      kind: "comment",
      anchor,
      target: { kind: "file", path: "x.ts", rev: "worktree" },
      body: "note",
      createdAt: "2026-01-01T00:00:00Z",
    };
  }

  test("a workbench thread paints its file-targeted working-tree notes", () => {
    const rows = diffRows(PATCH);
    const session = diffThread({ workbench: true }, [fileNote(rows)]);

    expect([...changesMarks(session, rows).keys()].length).toBeGreaterThan(0);
  });

  test("a pinned PR diff paints its file-scoped agent findings", () => {
    const rows = diffRows(PATCH);
    const finding = {
      ...fileNote(rows),
      author: "agent",
      reviewComment: {
        severity: "p1" as const,
        title: "Finding",
        path: "x.ts",
        line: 2,
        side: "RIGHT" as const,
      },
    };
    const session = diffThread({ pr: "org/repo#1" }, [finding]);

    expect([...changesMarks(session, rows).keys()].length).toBeGreaterThan(0);
  });

  test("an outdated PR finding stays on its recorded line without rebinding", () => {
    const rows = diffRows(PATCH);
    const finding: Annotation = {
      ...fileNote(rows),
      anchor: { quote: "text that is no longer present", prefix: "", suffix: "" },
      author: "agent",
      reviewComment: {
        severity: "p1",
        title: "Finding",
        path: "x.ts",
        line: 2,
        side: "RIGHT",
      },
    };
    const session = diffThread({ pr: "org/repo#1" }, [finding]);
    const marks = changesMarks(session, rows);

    const findingMark = [...marks.values()].flat().find((mark) => mark.annotationId === finding.id);

    expect(findingMark?.outdated).toBe(true);
  });

  test("replies stay grouped with an outdated PR finding", () => {
    const rows = diffRows(PATCH);
    const finding: Annotation = {
      ...fileNote(rows),
      anchor: { quote: "text that is no longer present", prefix: "", suffix: "" },
      author: "agent",
      reviewComment: {
        severity: "p1",
        title: "Finding",
        path: "x.ts",
        line: 2,
        side: "RIGHT",
      },
    };
    const reply: Annotation = {
      ...finding,
      id: "reply-1",
      author: "reviewer",
      body: "Keep this discussion visible.",
      replyTo: finding.id,
      reviewComment: undefined,
    };
    const marks = changesMarks(diffThread({ pr: "org/repo#1" }, [finding, reply]), rows);
    const marked = [...marks.values()].flat();
    const findingMark = marked.find((mark) => mark.annotationId === finding.id);
    const replyMark = marked.find((mark) => mark.annotationId === reply.id);

    expect(replyMark?.span).toEqual(findingMark?.span);
    expect(replyMark?.outdated).toBe(true);
  });

  test("a plain pinned diff ignores working-tree file targets", () => {
    const rows = diffRows(PATCH);
    const session = diffThread({}, [fileNote(rows)]);

    expect([...changesMarks(session, rows).keys()]).toEqual([]);
  });

  test("a shared snapshot still paints the workbench's file-targeted feedback", () => {
    const rows = diffRows(PATCH);
    // a served/shared snapshot keeps the workbench marker, so its notes stay file-targeted and visible
    const session = diffThread({ workbench: true, snapshot: true }, [fileNote(rows)]);

    expect([...changesMarks(session, rows).keys()].length).toBeGreaterThan(0);
  });
});
