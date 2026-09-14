import { useEffect, useRef } from "react";
import { persistLayout } from "./config";
import { layoutFromPanes, type LaunchLayout } from "./launch-layout";

/**
 * Persist the pane composition whenever the user changes it, so the next bare launch restores it.
 * Only a launch that carried an intended layout (a create-command or the vanilla inbox) remembers;
 * a bare thread open collapses the sidebar and must not clobber the remembered composition. The
 * mount write is skipped: the opening composition is the one just restored.
 */
export function useRememberLayout(
  layout: LaunchLayout | undefined,
  threads: boolean,
  changesOpen: boolean,
  projectOpen: boolean,
  zoomChanges: boolean,
): void {
  const settled = useRef(false);

  useEffect(() => {
    if (!settled.current) {
      settled.current = true;

      return;
    }
    if (layout === undefined) return;
    persistLayout(layoutFromPanes({ threads, changesOpen, projectOpen, zoomChanges }));
  }, [layout, threads, changesOpen, projectOpen, zoomChanges]);
}
