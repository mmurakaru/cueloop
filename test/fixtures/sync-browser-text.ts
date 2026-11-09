import { createSyncTextDocument } from "@cueloop/sync/text";

export function editBrowserText(options: { state: string; remoteState: string }) {
  const document = createSyncTextDocument({ state: options.state, canEdit: () => true });

  try {
    document.edit({ index: 0, deleteCount: 0, insert: "Browser: " });
    const update = document.updateSince(options.state);

    document.receive(options.remoteState);

    return { ...document.snapshot, update };
  } finally {
    document.close();
  }
}
