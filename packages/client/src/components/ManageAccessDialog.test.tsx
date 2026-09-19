import { describe, expect, test } from "bun:test";
import React, { useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../theme";
import { clickText, locateTextInFrame, pressKey, settle, typeText } from "../test-support";
import { NERD } from "./primitives/icons";
import { ManageAccessDialog } from "./ManageAccessDialog";

function AccessHarness({ initial }: { initial: string[] }): React.ReactNode {
  const [logins, setLogins] = useState<string[]>(initial);
  const [open, setOpen] = useState(true);

  return (
    <box style={{ width: 60, height: 18 }}>
      <ManageAccessDialog
        isOpen={open}
        logins={logins}
        onAdd={(login) => setLogins((prev) => [...prev, login])}
        onRemove={(login) => setLogins((prev) => prev.filter((entry) => entry !== login))}
        onCreateLink={() => {}}
        onClose={() => setOpen(false)}
        theme={DARK}
      />
    </box>
  );
}

async function renderAccess(initial: string[]): Promise<Awaited<ReturnType<typeof testRender>>> {
  const setup = await testRender(<AccessHarness initial={initial} />, { width: 60, height: 18 });

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

  test("typing a handle and pressing enter appends it to the allowlist", async () => {
    const setup = await renderAccess([]);

    await typeText(setup, "octocat");
    await pressKey(setup, "RETURN");

    expect(locateTextInFrame(setup.captureCharFrame(), "@octocat")).not.toBeNull();
  });

  test("clicking create publishes the private link", async () => {
    let created = false;
    const setup = await testRender(
      <box style={{ width: 60, height: 18 }}>
        <ManageAccessDialog
          isOpen
          logins={["octocat"]}
          onAdd={() => {}}
          onRemove={() => {}}
          onCreateLink={() => {
            created = true;
          }}
          onClose={() => {}}
          theme={DARK}
        />
      </box>,
      { width: 60, height: 18 },
    );

    await settle(setup);
    await clickText(setup, "create");

    expect(created).toBe(true);
  });

  test("clicking cancel dismisses the dialog", async () => {
    const setup = await renderAccess([]);

    await clickText(setup, "cancel");

    expect(locateTextInFrame(setup.captureCharFrame(), "Manage access")).toBeNull();
  });
});
