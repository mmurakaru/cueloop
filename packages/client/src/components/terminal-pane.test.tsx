/** The embedded terminal renderable runs a real PTY child through Ghostty's VT and paints its screen; a live `printf` child must show up in the OpenTUI frame. Skipped where no prebuilt libghostty-vt ships for the platform. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { waitForText } from "../test-support";
import {
  embeddedTerminalAvailable,
  registerTerminalPane,
  TerminalPaneRenderable,
} from "./terminal-pane";

registerTerminalPane();

describe("TerminalPaneRenderable", () => {
  test.skipIf(!embeddedTerminalAvailable())(
    "paints a live child process's output into the box",
    async () => {
      // Arrange / Act - a child that prints a known line
      const setup = await testRender(
        React.createElement("terminalPane", {
          command: "/bin/sh",
          args: ["-c", "printf 'HELLO-EMBED\\n'; sleep 5"],
          style: { width: 40, height: 6 },
        }),
        { width: 40, height: 6 },
      );

      // Assert - the child's output reaches the painted frame via Ghostty
      await waitForText(setup, "HELLO-EMBED");
      setup.renderer.destroy();
    },
  );

  test("exposes availability + the renderable class", () => {
    // Assert - the module loads and reports platform support honestly
    expect(typeof embeddedTerminalAvailable()).toBe("boolean");
    expect(TerminalPaneRenderable).toBeDefined();
  });
});
