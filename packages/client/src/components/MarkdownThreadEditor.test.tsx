import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../theme";
import { settle } from "../test-support";
import { MarkdownThreadEditor } from "./MarkdownThreadEditor";

describe("MarkdownThreadEditor", () => {
  test("opens on the working copy and shows the caret position and save hint", async () => {
    const setup = await testRender(
      <MarkdownThreadEditor
        initialText={"# Title\n\nbody text here\n"}
        theme={DARK}
        onSaveMarkdown={() => {}}
        onCancelEdit={() => {}}
      />,
      { width: 50, height: 12 },
    );

    await settle(setup);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Title");
    expect(frame).toContain("body text here");
    expect(frame).toContain("Ln 1/4");
    expect(frame).toContain("save");
    expect(frame).toContain("cancel");
    setup.renderer.destroy();
  });
});
