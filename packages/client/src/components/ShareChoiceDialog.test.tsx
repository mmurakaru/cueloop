import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../theme";
import { clickText, settle } from "../test-support";
import { ShareChoiceDialog } from "./ShareChoiceDialog";

interface ShareCounts {
  publicShares: number;
  privateShares: number;
  stopShares: number;
  closes: number;
}

async function renderDialog(
  selectedIndex = 0,
  canRevoke = false,
): Promise<{
  setup: Awaited<ReturnType<typeof testRender>>;
  counts: ShareCounts;
}> {
  const counts: ShareCounts = { publicShares: 0, privateShares: 0, stopShares: 0, closes: 0 };
  const setup = await testRender(
    <box style={{ width: 60, height: 12 }}>
      <ShareChoiceDialog
        isOpen
        selectedIndex={selectedIndex}
        canRevoke={canRevoke}
        onPublicShare={() => {
          counts.publicShares += 1;
        }}
        onPrivateShare={() => {
          counts.privateShares += 1;
        }}
        onStopSharing={() => {
          counts.stopShares += 1;
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

  test("offers stop sharing only when the thread already has a link", async () => {
    // not shared: no stop-sharing row
    const { setup: plain } = await renderDialog(0, false);

    expect(plain.captureCharFrame()).not.toContain("stop sharing");

    // already shared: the row appears and revokes on click
    const { setup, counts } = await renderDialog(2, true);

    expect(setup.captureCharFrame()).toContain("stop sharing");
    await clickText(setup, "stop sharing");
    expect(counts.stopShares).toBe(1);
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
          onStopSharing={() => {}}
          canRevoke={false}
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
