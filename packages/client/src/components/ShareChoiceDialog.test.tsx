import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../theme";
import { clickText, settle } from "../test-support";
import { ShareChoiceDialog } from "./ShareChoiceDialog";

interface ShareCounts {
  publicShares: number;
  privateShares: number;
  closes: number;
}

async function renderDialog(selectedIndex = 0): Promise<{
  setup: Awaited<ReturnType<typeof testRender>>;
  counts: ShareCounts;
}> {
  const counts: ShareCounts = { publicShares: 0, privateShares: 0, closes: 0 };
  const setup = await testRender(
    <box style={{ width: 60, height: 12 }}>
      <ShareChoiceDialog
        isOpen
        selectedIndex={selectedIndex}
        onPublicShare={() => {
          counts.publicShares += 1;
        }}
        onPrivateShare={() => {
          counts.privateShares += 1;
        }}
        onClose={() => {
          counts.closes += 1;
        }}
        theme={DARK}
      />
    </box>,
    { width: 60, height: 12 },
  );

  await settle(setup);

  return { setup, counts };
}

describe("ShareChoiceDialog", () => {
  test("offers both the public and private choice", async () => {
    // Arrange + Act
    const { setup } = await renderDialog();

    // Assert
    const frame = setup.captureCharFrame();

    expect(frame).toContain("public link");
    expect(frame).toContain("private link");
  });

  test("clicking the public choice publishes and closes", async () => {
    // Arrange
    const { setup, counts } = await renderDialog();

    // Act
    await clickText(setup, "public link");

    // Assert
    expect(counts.publicShares).toBe(1);
    expect(counts.privateShares).toBe(0);
    expect(counts.closes).toBe(1);
  });

  test("clicking the private choice opens manage-access and closes", async () => {
    // Arrange
    const { setup, counts } = await renderDialog();

    // Act
    await clickText(setup, "private link");

    // Assert
    expect(counts.privateShares).toBe(1);
    expect(counts.publicShares).toBe(0);
    expect(counts.closes).toBe(1);
  });

  test("renders nothing while closed", async () => {
    // Arrange + Act
    const setup = await testRender(
      <box style={{ width: 60, height: 12 }}>
        <ShareChoiceDialog
          isOpen={false}
          selectedIndex={0}
          onPublicShare={() => {}}
          onPrivateShare={() => {}}
          onClose={() => {}}
          theme={DARK}
        />
      </box>,
      { width: 60, height: 12 },
    );

    await settle(setup);

    // Assert
    expect(setup.captureCharFrame()).not.toContain("public link");
  });
});
