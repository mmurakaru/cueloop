import type { SyncTextEditorSession, SyncTextEditorSnapshot } from "@cueloop/sync/text";
import { waitForTestSyncState } from "./sync-test-deadline";

export async function waitForTestTextEditor(
  session: SyncTextEditorSession,
  predicate: (snapshot: SyncTextEditorSnapshot) => boolean,
  label: string,
): Promise<void> {
  const reached = Promise.withResolvers<void>();
  const check = () => {
    if (predicate(session.getSnapshot())) reached.resolve();
  };
  const unsubscribe = session.subscribe(check);

  try {
    check();
    await waitForTestSyncState(reached.promise, label);
  } finally {
    unsubscribe();
  }
}
