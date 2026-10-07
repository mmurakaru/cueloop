import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DARK } from "../../appearance/theme";
import { press, waitForText } from "../../testing/test-support";
import { ShareDialog } from "./ShareDialog";
import { newWizardDraft, shareDialogStore } from "./share-dialog-store";
import type { NewShareLink } from "../../thread/thread-controller";

for (const enabled of [false, true])
  test(`share agent toggle is ${enabled ? "opt-in" : "hidden"}`, async () => {
    const created: NewShareLink[] = [];

    shareDialogStore.getState().reset();
    shareDialogStore.getState().openWizard(newWizardDraft("Review"));
    const setup = await testRender(
      <ShareDialog
        isOpen
        isOwner
        agentAvailable={enabled}
        links={[]}
        threadName="Review"
        theme={DARK}
        onCreateLink={(input) => created.push(input)}
        onUpdateLink={() => {}}
        onDeleteLink={() => {}}
        onCopyLink={() => {}}
        onClose={() => {}}
      />,
      { width: 100, height: 26 },
    );

    try {
      await waitForText(setup, "link name");
      expect(shareDialogStore.getState().wizard?.agentEnabled ?? false).toBe(false);
      expect(setup.captureCharFrame().includes("Allow agent messages")).toBe(enabled);
      await press(setup, "down");
      await press(setup, "down");

      if (enabled) {
        await press(setup, " ");
        await press(setup, "down");
      }

      await press(setup, "enter");
      expect(created).toHaveLength(1);
      expect(created[0]?.agentEnabled).toBe(enabled ? true : undefined);
    } finally {
      setup.renderer.destroy();
      shareDialogStore.getState().reset();
    }
  });
