import { useEffect, useRef, useState } from "react";
import type { DiffFileContents } from "@cueloop/schema";

const REFRESH_MS = 2000;

function sameFiles(a: readonly DiffFileContents[], b: readonly DiffFileContents[]): boolean {
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

/** Keep the visible Changes tree aligned with the live repo, including commits that leave it clean. */
export function useRepoChanges(
  load: () => Promise<readonly DiffFileContents[]>,
  active: boolean,
  reloadKey: string,
  live = true,
): readonly DiffFileContents[] {
  const [files, setFiles] = useState<readonly DiffFileContents[]>([]);
  const loadRef = useRef(load);
  const lastKey = useRef(reloadKey);

  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!active) return;
    if (lastKey.current !== reloadKey) {
      lastKey.current = reloadKey;
      setFiles([]);
    }
    let alive = true;
    let loading = false;

    const refresh = async (): Promise<void> => {
      if (loading) return;
      loading = true;
      try {
        const next = await loadRef.current();
        if (alive) setFiles((previous) => (sameFiles(previous, next) ? previous : next));
      } catch {
        if (alive) setFiles((previous) => (previous.length === 0 ? previous : []));
      } finally {
        loading = false;
      }
    };

    void refresh();
    const timer = live ? setInterval(() => void refresh(), REFRESH_MS) : null;

    return () => {
      alive = false;
      if (timer !== null) clearInterval(timer);
    };
  }, [active, reloadKey, live]);

  return files;
}
