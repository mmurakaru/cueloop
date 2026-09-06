// The Changes/Project right-region state machine: the Project pane is the right sidebar and is always
// present when the region is on, the Changes editor rides on it and never stands alone, and the two
// toggles are mutually-exclusive file-tree modes. Owns the editor grid (tabs and splits) too.

import { useRef, useState } from "react";
import type { ProjectPanelMode } from "./components/AppShell";
import {
  activateTab,
  addTab,
  changesTab,
  closeTab,
  fileTab,
  firstGroupId,
  makeGroup,
  splitGroup,
  type EditorNode,
  type SplitDirection,
} from "./components/editor-grid";

export interface ChangesWorkbench {
  projectOpen: boolean;
  changesOpen: boolean;
  projectMode: ProjectPanelMode;
  zoomed: boolean;
  grid: EditorNode;
  activeGroup: string;
  toggleRight: () => void;
  toggleChanges: () => void;
  toggleProject: () => void;
  toggleZoom: () => void;
  focusGroup: (groupId: string) => void;
  activate: (groupId: string, tabId: string) => void;
  close: (groupId: string, tabId: string) => void;
  split: (groupId: string, direction: SplitDirection) => void;
  openFile: (path: string, fileView: "diff" | "contents") => void;
  /** Re-open defaults when the session changes: a diff opens the region in changed-files mode. */
  syncSession: (sessionId: string | undefined, isDiff: boolean) => void;
}

export function useChangesWorkbench(): ChangesWorkbench {
  const [projectOpen, setProjectOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [projectMode, setProjectMode] = useState<ProjectPanelMode>("changes");
  const [zoomed, setZoomed] = useState(false);
  const [grid, setGrid] = useState<EditorNode>(() => makeGroup([changesTab()]));
  const [focusedGroup, setFocusedGroup] = useState<string | null>(null);
  const rememberedChanges = useRef(false);
  const seenSession = useRef<string | undefined>(undefined);

  const syncSession = (sessionId: string | undefined, isDiff: boolean): void => {
    if (sessionId === undefined || sessionId === seenSession.current) return;
    seenSession.current = sessionId;
    setProjectOpen(isDiff);
    setChangesOpen(isDiff);
    setProjectMode(isDiff ? "changes" : "tree");
    rememberedChanges.current = isDiff;
    setGrid(makeGroup([changesTab()]));
    setFocusedGroup(null);
  };

  const toggleRight = (): void => {
    if (projectOpen) {
      rememberedChanges.current = changesOpen;
      setChangesOpen(false);
      setProjectOpen(false);
    } else {
      setProjectOpen(true);
      setChangesOpen(rememberedChanges.current);
      setProjectMode(rememberedChanges.current ? "changes" : "tree");
    }
  };
  const toggleChanges = (): void => {
    if (projectMode === "changes") {
      setChangesOpen(false);
      setProjectMode("tree");
    } else {
      setChangesOpen(true);
      setProjectOpen(true);
      setProjectMode("changes");
    }
  };
  const toggleProject = (): void => {
    setProjectOpen(true);
    setProjectMode("tree");
  };
  const close = (groupId: string, tabId: string): void => {
    setGrid((tree) => {
      const pruned = closeTab(tree, groupId, tabId);
      if (pruned === null) {
        setChangesOpen(false);
        setProjectMode("tree");
        return makeGroup([changesTab()]);
      }
      return pruned;
    });
  };
  const split = (groupId: string, direction: SplitDirection): void => {
    setGrid((tree) => {
      const result = splitGroup(tree, groupId, direction);
      setFocusedGroup(result.focusGroupId);
      return result.tree;
    });
  };
  const openFile = (path: string, fileView: "diff" | "contents"): void => {
    setProjectOpen(true);
    setChangesOpen(true);
    const label = path.split("/").pop() ?? path;
    setGrid((tree) =>
      addTab(tree, focusedGroup ?? firstGroupId(tree), fileTab(label, path, fileView)),
    );
  };

  return {
    projectOpen,
    changesOpen,
    projectMode,
    zoomed,
    grid,
    activeGroup: focusedGroup ?? firstGroupId(grid),
    toggleRight,
    toggleChanges,
    toggleProject,
    toggleZoom: () => setZoomed((value) => !value),
    focusGroup: setFocusedGroup,
    activate: (groupId, tabId) => setGrid((tree) => activateTab(tree, groupId, tabId)),
    close,
    split,
    openFile,
    syncSession,
  };
}
