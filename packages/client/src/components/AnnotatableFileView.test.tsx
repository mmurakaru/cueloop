/**
 * A project file is its own annotation surface: selecting a line and typing leaves a comment whose
 * anchor quotes that file line, handed up as an Anchor the app persists with a file target.
 */

import { describe, expect, mock, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import React from "react";
import { SCHEMA_VERSION, type Anchor, type Thread } from "@cueloop/schema";
import { AnnotatableFileView } from "./AnnotatableFileView";
import { DARK } from "../theme";
import { dragText, typeText, pressKey, waitForText } from "../test-support";

const SAMPLE = "export function add(a: number, b: number) {\n  return a + b;\n}\n";

function planSession(): Thread {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "ses_plan",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# Plan\n", meta: {} },
    revisions: [{ revision: 1, content: "# Plan\n", submittedAt: "2026-01-01T00:00:00Z" }],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const noop = (): void => {};

describe("AnnotatableFileView", () => {
  test("commenting a file line hands up an anchor that quotes the line", async () => {
    const onAddComment = mock((_anchor: Anchor, _body: string) => {});
    const setup = await testRender(
      <AnnotatableFileView
        path="src/add.ts"
        loadContents={() => Promise.resolve(SAMPLE)}
        session={planSession()}
        quickActions={[]}
        observer={false}
        onAddComment={onAddComment}
        onReply={noop}
        onUpdateAnnotation={noop}
        onExit={noop}
        theme={DARK}
      />,
      { width: 64, height: 12 },
    );

    // Act - select the middle line, type a comment, send it
    await waitForText(setup, "return a + b");
    await dragText(setup, "return a + b", "return a + b", "return a + b".length);
    await typeText(setup, "why not reduce?");
    await pressKey(setup, "RETURN", { meta: true });

    // Assert - the surface built an anchor quoting the file line and handed it up with the body
    expect(onAddComment).toHaveBeenCalled();
    const [anchor, body] = onAddComment.mock.calls[0]!;
    expect(anchor.quote).toContain("return a + b");
    expect(body).toContain("why not reduce?");

    setup.renderer.destroy();
  });

  test("a head-side (deleted-line) note never rebinds onto the current file", async () => {
    const session = planSession();
    // a note left on the removed side of this file: the worktree view must not show it
    session.annotations = [
      {
        id: "h1",
        kind: "comment",
        anchor: { quote: "return a + b", prefix: "", suffix: "" },
        target: { kind: "file", path: "src/add.ts", rev: "head" },
        body: "deleted-side note",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    const setup = await testRender(
      <AnnotatableFileView
        path="src/add.ts"
        loadContents={() => Promise.resolve(SAMPLE)}
        session={session}
        quickActions={[]}
        observer={false}
        onAddComment={noop}
        onReply={noop}
        onUpdateAnnotation={noop}
        onExit={noop}
        theme={DARK}
      />,
      { width: 64, height: 12 },
    );

    await waitForText(setup, "return a + b");

    // Assert - the current file shows, but the head-side note is not attached to it
    expect(setup.captureCharFrame()).not.toContain("deleted-side note");

    setup.renderer.destroy();
  });
});
