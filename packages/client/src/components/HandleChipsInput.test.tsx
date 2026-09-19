/** Backspace on the empty field pulls the last chip back in to edit, rather than deleting it. */

import React, { useState } from "react";
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../theme";
import { press, settle } from "../test-support";
import { HandleChipsInput } from "./HandleChipsInput";

/** A controlled host so onChange edits flow back into the rendered list, like the wizard. */
function Harness({ initial }: { initial: string[] }): React.ReactNode {
  const [logins, setLogins] = useState(initial);

  return <HandleChipsInput logins={logins} onChange={setLogins} theme={DARK} />;
}

describe("HandleChipsInput", () => {
  test("backspace on the empty field restores the last chip as editable text", async () => {
    // Arrange - one committed chip and an empty input showing its placeholder
    const setup = await testRender(<Harness initial={["octocat"]} />, { width: 48, height: 6 });

    await settle(setup);
    expect(setup.captureCharFrame()).toContain("handle");

    // Act - backspace with the input empty
    await press(setup, "backspace");

    // Assert - the handle is back in the field (placeholder gone), not deleted
    const frame = setup.captureCharFrame();

    expect(frame).toContain("octocat");
    expect(frame).not.toContain("handle");
    setup.renderer.destroy();
  });
});
