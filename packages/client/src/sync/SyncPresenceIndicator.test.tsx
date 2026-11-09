import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  createSyncTextState,
  createSyncTextDocument,
  createSyncTextPosition,
} from "@cueloop/sync/text";
import { DARK } from "../appearance/theme";
import { settle } from "../testing/test-support";
import { SyncPresenceIndicator } from "./SyncPresenceIndicator";

const DOCUMENT = "019a6819-bf85-7000-8000-000000000001";

test.each([
  { stage: "initial", label: "alice typing selecting 1-4" },
  { stage: "inserted", label: "alice typing selecting 8-11" },
  { stage: "removed", label: "alice typing selection unavailable" },
])("presence displays a text-aware selection after $stage text", async ({ stage, label }) => {
  const initial = createSyncTextState("Plan");
  const document = createSyncTextDocument({ state: initial.state, canEdit: () => true });
  const selection = {
    documentIdentifier: DOCUMENT,
    anchor: createSyncTextPosition({ state: initial.state, index: 0, association: 0 }),
    focus: createSyncTextPosition({ state: initial.state, index: 4 }),
  };

  if (stage !== "initial") document.edit({ index: 0, deleteCount: 0, insert: "Shared " });

  if (stage === "removed") document.edit({ index: 7, deleteCount: 4, insert: "" });

  const setup = await testRender(
    <SyncPresenceIndicator
      presence={{
        status: "connected",
        peers: [
          {
            actorIdentifier: "alice",
            workspaceIdentifier: DOCUMENT,
            connectionIdentifier: DOCUMENT,
            sequence: 1,
            typing: true,
            selection,
            expiresAt: 16000,
          },
        ],
      }}
      textState={document.snapshot.state}
      documentIdentifier={DOCUMENT}
      theme={DARK}
    />,
    { width: 70, height: 5 },
  );

  try {
    await settle(setup);
    expect(setup.captureCharFrame()).toContain(label);
  } finally {
    setup.renderer.destroy();
    document.close();
  }
});
