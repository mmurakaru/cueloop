import { describe, expect, test } from "bun:test";
import React, { useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../theme";
import { clickText, locateTextInFrame, pressKey, settle, typeText } from "../test-support";
import { NERD } from "./primitives/icons";
import { ManageAccessDialog } from "./ManageAccessDialog";

function AccessHarness({
  initial,
  onCreate,
}: {
  initial: string[];
  onCreate?: (logins: string[]) => void;
}): React.ReactNode {
  const [open, setOpen] = useState(true);

  return (
    <box style={{ width: 60, height: 18 }}>
      {open ? (
        <ManageAccessDialog
          isOpen
          initialLogins={initial}
          onCreate={(logins) => onCreate?.(logins)}
          onClose={() => setOpen(false)}
          theme={DARK}
        />
      ) : null}
    </box>
  );
}

async function renderAccess(
  initial: string[],
  onCreate?: (logins: string[]) => void,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(<AccessHarness initial={initial} onCreate={onCreate} />, {
    width: 60,
    height: 18,
  });

  await settle(setup);

  return setup;
}

describe("ManageAccessDialog", () => {
  test("renders the allowlist of GitHub handles", async () => {
    const setup = await renderAccess(["octocat", "hubot"]);
    const frame = setup.captureCharFrame();

    expect(locateTextInFrame(frame, "@octocat")).not.toBeNull();
    expect(locateTextInFrame(frame, "@hubot")).not.toBeNull();
  });

  test("hovering a handle chip reveals an × that removes it", async () => {
    const setup = await renderAccess(["octocat", "hubot"]);

    // hover the chip so its remove × appears, then click it
    const chip = locateTextInFrame(setup.captureCharFrame(), "@octocat")!;

    await setup.mockMouse.moveTo(chip.column, chip.row);
    await settle(setup);
    await clickText(setup, NERD.close);

    expect(locateTextInFrame(setup.captureCharFrame(), "@octocat")).toBeNull();
    expect(locateTextInFrame(setup.captureCharFrame(), "@hubot")).not.toBeNull();
  });

  test("typing a handle and pressing enter appends it to the draft", async () => {
    const setup = await renderAccess([]);

    await typeText(setup, "octocat");
    await pressKey(setup, "RETURN");

    expect(locateTextInFrame(setup.captureCharFrame(), "@octocat")).not.toBeNull();
  });

  test("clicking create publishes with the drafted allowlist", async () => {
    const created: string[][] = [];
    const setup = await renderAccess(["octocat"], (logins) => created.push(logins));

    await clickText(setup, "create");

    expect(created[0]).toEqual(["octocat"]);
  });

  test("clicking cancel dismisses the dialog", async () => {
    const setup = await renderAccess([]);

    await clickText(setup, "cancel");

    expect(locateTextInFrame(setup.captureCharFrame(), "Manage access")).toBeNull();
  });
});
