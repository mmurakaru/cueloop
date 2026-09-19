import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../theme";
import { press, settle } from "../test-support";
import { MarkdownThreadEditor, type MarkdownEditorHandle } from "./MarkdownThreadEditor";

describe("MarkdownThreadEditor", () => {
  test("opens on the working copy and shows the caret position and save hint", async () => {
    const setup = await testRender(
      <MarkdownThreadEditor
        initialText={"# Title\n\nbody text here\n"}
        theme={DARK}
        onExitEditor={() => {}}
      />,
      { width: 50, height: 12 },
    );

    await settle(setup);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Title");
    expect(frame).toContain("body text here");
    expect(frame).toContain("Ln 1/4");
    expect(frame).toContain("save & close");
    setup.renderer.destroy();
  });

  test("the exit handle saves the current text and leaves (the header toggle's path)", async () => {
    const handleRef = React.createRef<MarkdownEditorHandle>();
    let exitedWith = "";
    const setup = await testRender(
      <MarkdownThreadEditor
        ref={handleRef}
        initialText={"keep this"}
        theme={DARK}
        onExitEditor={(text) => {
          exitedWith = text;
        }}
      />,
      { width: 40, height: 8 },
    );

    await settle(setup);
    handleRef.current?.requestExit();

    expect(exitedWith).toBe("keep this");
    setup.renderer.destroy();
  });

  test("highlights align to the exact characters across lines (no newline drift)", async () => {
    const setup = await testRender(
      <MarkdownThreadEditor
        initialText={"# Head\n\nrun `code` now\n"}
        theme={DARK}
        onExitEditor={() => {}}
      />,
      { width: 40, height: 10 },
    );

    await settle(setup);
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const hexOf = (color: { toInts: () => number[] }): string =>
      "#" +
      color
        .toInts()
        .slice(0, 3)
        .map((part) => part.toString(16).padStart(2, "0"))
        .join("");
    // the code highlight must cover exactly `code`, not a drifted slice like "ode` "
    const codeSpan = spans.find((span) => span.text === "`code`");

    expect(codeSpan).toBeDefined();
    expect(codeSpan?.fg && hexOf(codeSpan.fg)).toBe(DARK.textDim);
    setup.renderer.destroy();
  });

  test("escape is a no-op - it never leaves the editor (IDE convention)", async () => {
    let exits = 0;
    const setup = await testRender(
      <MarkdownThreadEditor
        initialText={"stay put"}
        theme={DARK}
        onExitEditor={() => {
          exits += 1;
        }}
      />,
      { width: 40, height: 8 },
    );

    await settle(setup);
    await press(setup, "escape");

    expect(exits).toBe(0);
    expect(setup.captureCharFrame()).toContain("save & close");
    setup.renderer.destroy();
  });
});
