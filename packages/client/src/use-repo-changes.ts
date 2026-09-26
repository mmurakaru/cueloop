import { useEffect, useEffectEvent, useState } from "react";
import type { DiffFileContents } from "@cueloop/schema";

const CHANGES_REFRESH_MS = 2000;
const EMPTY_CHANGED_FILES: readonly DiffFileContents[] = [];

interface RepoChangesOptions {
  loadChanges: () => Promise<readonly DiffFileContents[]>;
  visible: boolean;
  diffSourceKey: string;
  refreshAutomatically?: boolean;
}

interface RepoChangesSnapshot {
  diffSourceKey: string;
  files: readonly DiffFileContents[];
}

function sameChangedFiles(a: readonly DiffFileContents[], b: readonly DiffFileContents[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (file, index) =>
        file.path === b[index]?.path &&
        file.status === b[index]?.status &&
        file.oldContents === b[index]?.oldContents &&
        file.newContents === b[index]?.newContents,
    )
  );
}

/** Refresh the visible Changes tree from the working repo; keep captured diff reviews fixed. */
export function useRepoChanges({
  loadChanges,
  visible,
  diffSourceKey,
  refreshAutomatically = true,
}: RepoChangesOptions): readonly DiffFileContents[] {
  const [snapshot, setSnapshot] = useState<RepoChangesSnapshot | null>(null);
  const loadLatestChanges = useEffectEvent(loadChanges);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    let requestInFlight = false;

    const refreshChanges = async (): Promise<void> => {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const files = await loadLatestChanges();

        if (!cancelled) {
          setSnapshot((previous) =>
            previous?.diffSourceKey === diffSourceKey && sameChangedFiles(previous.files, files)
              ? previous
              : { diffSourceKey, files },
          );
        }
      } catch {
        if (!cancelled) {
          setSnapshot((previous) =>
            previous?.diffSourceKey === diffSourceKey && previous.files.length === 0
              ? previous
              : { diffSourceKey, files: EMPTY_CHANGED_FILES },
          );
        }
      } finally {
        requestInFlight = false;
      }
    };

    void refreshChanges();
    const timer = refreshAutomatically
      ? setInterval(() => void refreshChanges(), CHANGES_REFRESH_MS)
      : null;

    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [visible, diffSourceKey, refreshAutomatically]);

  return snapshot?.diffSourceKey === diffSourceKey ? snapshot.files : EMPTY_CHANGED_FILES;
}
