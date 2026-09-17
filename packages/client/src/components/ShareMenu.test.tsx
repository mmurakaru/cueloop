import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../theme";
import { clickText, press, settle } from "../test-support";
import { MenuControlProvider, useMenuControlState } from "./menu-control";
import { RootOverlayProvider } from "./RootOverlay";
import { ShareMenu } from "./ShareMenu";

interface ShareCounts {
  publicShares: number;
  privateShares: number;
}

function ShareMenuHarness({
  onPublicShare,
  onPrivateShare,
}: {
  onPublicShare: () => void;
  onPrivateShare: () => void;
}): React.ReactNode {
  const menuControl = useMenuControlState();

  return (
    <MenuControlProvider value={menuControl}>
      <RootOverlayProvider>
        <box style={{ width: 52, height: 12, flexDirection: "column" }}>
          <ShareMenu onPublicShare={onPublicShare} onPrivateShare={onPrivateShare} theme={DARK} />
        </box>
      </RootOverlayProvider>
    </MenuControlProvider>
  );
}

async function renderShareMenu(): Promise<{
  setup: Awaited<ReturnType<typeof testRender>>;
  counts: ShareCounts;
}> {
  const counts: ShareCounts = { publicShares: 0, privateShares: 0 };
  const setup = await testRender(
    <ShareMenuHarness
      onPublicShare={() => {
        counts.publicShares += 1;
      }}
      onPrivateShare={() => {
        counts.privateShares += 1;
      }}
    />,
    { width: 52, height: 12 },
  );

  await settle(setup);

  return { setup, counts };
}

describe("ShareMenu", () => {
  test("opens a popover on share instead of publishing immediately", async () => {
    // Arrange
    const { setup, counts } = await renderShareMenu();

    // Act
    await clickText(setup, "share");

    // Assert
    const frame = setup.captureCharFrame();

    expect(frame).toContain("public link");
    expect(frame).toContain("private link");
    expect(counts.publicShares).toBe(0);
  });

  test("the public choice publishes the connection line", async () => {
    // Arrange
    const { setup, counts } = await renderShareMenu();

    // Act
    await clickText(setup, "share");
    await clickText(setup, "public link");

    // Assert
    expect(counts.publicShares).toBe(1);
    expect(counts.privateShares).toBe(0);
  });

  test("the private choice opens the manage-access seam", async () => {
    // Arrange
    const { setup, counts } = await renderShareMenu();

    // Act
    await clickText(setup, "share");
    await clickText(setup, "private link");

    // Assert
    expect(counts.privateShares).toBe(1);
    expect(counts.publicShares).toBe(0);
  });

  test("arrow-down then enter picks the private choice", async () => {
    // Arrange
    const { setup, counts } = await renderShareMenu();

    // Act
    await clickText(setup, "share");
    await press(setup, "down");
    await press(setup, "enter");

    // Assert
    expect(counts.privateShares).toBe(1);
  });

  test("clicking outside the panel closes the popover", async () => {
    // Arrange - the escape keybinding is wired the same way as the split menu; the
    // test harness cannot deliver a lone escape byte, so dismissal is driven by the backdrop
    const { setup } = await renderShareMenu();

    // Act
    await clickText(setup, "share");
    await setup.mockMouse.click(50, 11);
    await settle(setup);

    // Assert
    expect(setup.captureCharFrame()).not.toContain("public link");
  });

  test("clicking share again closes the open popover", async () => {
    // Arrange
    const { setup } = await renderShareMenu();

    // Act
    await clickText(setup, "share");
    await clickText(setup, "share");

    // Assert
    expect(setup.captureCharFrame()).not.toContain("private link");
  });
});
