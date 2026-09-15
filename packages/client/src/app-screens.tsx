import { ScrollArea } from "./components/ScrollArea";
import React, { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { DiffFileContents, Thread, VerdictKind } from "@cueloop/schema";
import { returnPaneFor } from "@cueloop/schema";
import type { Theme } from "./theme";
import type { QuickAction } from "./config";
import type { LaunchLayout } from "./launch-layout";
import { useRememberLayout } from "./use-remember-layout";
import type { Mode, TreeAsk } from "./intent-dispatch";
import type { Intent } from "./keymap";
import type { ReviewController, ToastState } from "./thread-controller";
import { noteForFile } from "./walk";
import type { WalkFile } from "./walk";
import type { CheatsheetSection } from "./key-bindings";
import type { SettingsCategory, SettingsValues } from "./components/SettingsDialog";
import type { SettingsNav } from "./use-settings-dialog";
import { CLIENT_VERSION } from "./version";
import { ThemeProvider } from "./components/theme-context";
import type { InboxRow } from "./components/session-tree";
import { SettingsDialog } from "./components/SettingsDialog";
import { CompletionOverlay } from "./components/CompletionOverlay";
import { ThreadTree } from "./components/ThreadTree";
import { WelcomePlayground } from "./components/WelcomePlayground";
import { AppShell, type FocusPane, type ProjectPanelMode } from "./components/AppShell";
import { EditorGrid } from "./components/EditorGrid";
import { MenuControlProvider, useMenuControlState } from "./components/menu-control";
import { ProjectTreeView } from "./components/ProjectTreeView";
import { ChangesFileTree } from "./components/ChangesColumn";
import { BareWorkbenchFileView, draftThread } from "./components/BareWorkbenchFileView";
import { GridTabContent, type DiffSurfaceProps } from "./components/GridTabContent";
import { useChangesWorkbench } from "./use-changes-workbench";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { PromptDialog } from "./components/PromptDialog";
import { WalkWizard } from "./components/WalkWizard";
import { Toast } from "./components/Toast";

export function ErrorScreen({ error, theme }: { error: string; theme: Theme }): React.ReactNode {
  return (
    <ThemeProvider theme={theme}>
      <text fg={theme.red}>cueloop: {error}</text>
    </ThemeProvider>
  );
}

export function ConnectingScreen({ theme }: { theme: Theme }): React.ReactNode {
  return (
    <ThemeProvider theme={theme}>
      <text fg={theme.textDim}>connecting to the daemon…</text>
    </ThemeProvider>
  );
}

export function MenuChrome(props: {
  menuDialog: "keybinds" | "settings" | null;
  theme: Theme;
  keybindsSections: CheatsheetSection[];
  settingsCategories: SettingsCategory[];
  settingsValues: SettingsValues;
  settingsNav: SettingsNav;
  onCategorySelect: (categoryId: string) => void;
  cycleSetting: (rowKey: string) => void;
  onClose: () => void;
}): React.ReactNode {
  const {
    menuDialog,
    theme,
    keybindsSections,
    settingsCategories,
    settingsValues,
    settingsNav,
    onCategorySelect,
    cycleSetting,
    onClose,
  } = props;

  // the gear opens the settings dialog directly; Keybinds is a leaf in its tree nav
  if (menuDialog !== "settings") return null;

  return (
    <SettingsDialog
      isOpen
      version={CLIENT_VERSION}
      keybindsSections={keybindsSections}
      categories={settingsCategories}
      values={settingsValues}
      activeCategoryId={settingsNav.categoryId}
      activeRowIndex={settingsNav.rowIndex}
      activeZone={settingsNav.zone}
      onCategorySelect={onCategorySelect}
      onRowActivate={(row) => cycleSetting(row.key)}
      onClose={onClose}
      theme={theme}
    />
  );
}

/** The welcome shell's Project pane: the launch repo's changed files in changes mode, its full tree otherwise. */
/** A shared empty rejected-rows set: the bare-launch diff rejects nothing, and this keeps a stable ref. */
const EMPTY_ROWS: Set<number> = new Set();

function WelcomeProjectPanel({
  mode,
  controller,
  onOpenChangedFile,
  onOpenProjectFile,
  focused,
  theme,
}: {
  mode: ProjectPanelMode;
  controller: ReviewController;
  /** Changes tree click -> open the file's working-tree diff. */
  onOpenChangedFile: (path: string) => void;
  /** Project tree click -> open the file's read-only contents. */
  onOpenProjectFile: (path: string) => void;
  focused?: boolean;
  theme: Theme;
}): React.ReactNode {
  const [changes, setChanges] = useState<readonly DiffFileContents[]>([]);

  useEffect(() => {
    let alive = true;

    void controller.repoChanges().then(
      (files) => {
        if (alive) setChanges(files);
      },
      () => {
        if (alive) setChanges([]);
      },
    );

    return () => {
      alive = false;
    };
  }, [controller]);

  if (mode === "changes") {
    return (
      <ChangesFileTree
        files={changes}
        onSelectFile={onOpenChangedFile}
        focused={focused}
        theme={theme}
      />
    );
  }

  return (
    <ProjectTreeView
      loadFiles={() => controller.repoFiles()}
      onSelectFile={onOpenProjectFile}
      focused={focused}
      theme={theme}
    />
  );
}

/**
 * The shell with no thread open: the same header and Projects/Threads sidebar as
 * the thread view, and a disposable Welcome tab in the center. There is no
 * separate inbox screen - opening the app lands here, and picking a thread swaps
 * the center for it. Closing the Welcome tab leaves a bare "select a thread" hint.
 */
export function NoThreadShell(props: {
  rows: InboxRow[];
  inboxCursor: number;
  mode: Mode;
  theme: Theme;
  controller: ReviewController;
  setMode: Dispatch<SetStateAction<Mode>>;
  menuChrome: React.ReactNode;
  onOpenMenu: () => void;
  /** Shared with the thread view, so picking a thread preserves the sidebar. */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  focusedPane: FocusPane;
  onFocusPane: (pane: FocusPane) => void;
  pinnedIds: ReadonlySet<string>;
  onPin: (id: string) => void;
  onRename: (id: string, title: string) => void;
  /** Drives the "/" quick actions and skills in the welcome playground's composer. */
  quickActions: QuickAction[];
  /** Reports the welcome composer's open state, so the shell suspends its inbox keys while typing. */
  onWelcomeComposingChange: (composing: boolean) => void;
  /** The pane composition this vanilla launch restores; changes here are remembered for the next one. */
  layout?: LaunchLayout;
}): React.ReactNode {
  const {
    rows,
    inboxCursor,
    mode,
    theme,
    controller,
    setMode,
    menuChrome,
    onOpenMenu,
    sidebarOpen,
    onToggleSidebar,
    focusedPane,
    onFocusPane,
    pinnedIds,
    onPin,
    onRename,
    quickActions,
    onWelcomeComposingChange,
    layout,
  } = props;
  const confirming = mode.type === "confirmDelete" ? mode : null;
  const menuControl = useMenuControlState();
  // The bare-launch shell is the same four panes as a thread: the Thread pane waits in its empty state
  // and a disposable Welcome tab rides in the Changes editor until a thread or diff is opened.
  const workbench = useChangesWorkbench({ seed: "welcome", layout });
  // the vanilla shell remembers the composition the user leaves it in, for the next bare launch
  useRememberLayout(
    layout,
    true,
    sidebarOpen,
    workbench.changesOpen,
    workbench.projectOpen,
    workbench.zoomed,
  );
  // the Changes tree opens a file's working-tree diff; the Project tree opens read-only contents
  const openChangedFile = (path: string): void => {
    // no thread means no live-diff refresh loop, so re-capture on open or a long-lived shell goes
    // stale; the catch keeps a fire-and-forget refresh from throwing when the shell tears down
    void controller.repoChanges().catch(() => undefined);
    workbench.openFile(path, "diff");
  };
  const openProjectFile = (path: string): void => workbench.openFile(path, "contents");
  // a bare launch has no thread yet, so the diff renders against a draft session; the first note
  // promotes it to the per-repo workbench thread (commentOnWorkbenchDiff)
  const draft = useMemo(() => draftThread(), []);
  const bareSurface: DiffSurfaceProps = {
    session: draft,
    quickActions,
    observer: false,
    commentsEnabled: true,
    resolved: false,
    suspended: focusedPane !== "changes" || menuControl.openMenuId !== null,
    onComposingChange: onWelcomeComposingChange,
    onObserverBlocked: () => {},
    onCursorChange: () => {},
    focusedAnnotationId: undefined,
    onFocusAnnotation: () => {},
    onAnnotate: (span, body) =>
      void controller.commentOnWorkbenchDiff(
        span.start.blockIndex,
        span.start.char,
        span.end.char,
        span.end.blockIndex,
        body,
      ),
    onReply: () => undefined,
    onUpdateAnnotation: () => {},
    onExit: () => {},
  };

  return (
    <ThemeProvider theme={theme}>
      <MenuControlProvider value={menuControl}>
        <AppShell
          sidebarOpen={sidebarOpen}
          onToggleSidebar={onToggleSidebar}
          onOpenMenu={onOpenMenu}
          onFocusPane={onFocusPane}
          threadsPanel={
            <ScrollArea>
              <ThreadTree
                rows={rows}
                cursor={inboxCursor}
                focused={focusedPane === "threads"}
                pinnedIds={pinnedIds}
                width={30}
                onSelect={(id) => controller.open(id)}
                onRequestDelete={(id, title) =>
                  setMode({ type: "confirmDelete", sessionId: id, title })
                }
                onPin={onPin}
                onRename={onRename}
                theme={theme}
              />
            </ScrollArea>
          }
          threadTitle=""
          threadPanel={
            <box
              style={{
                flexGrow: 1,
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <text fg={theme.textDim}>Select a thread</text>
            </box>
          }
          changesOpen={workbench.changesOpen}
          projectOpen={workbench.projectOpen}
          onToggleChanges={workbench.toggleChanges}
          onToggleProject={workbench.toggleProject}
          onToggleRight={workbench.toggleRight}
          projectMode={workbench.projectMode}
          zoomHideThread={workbench.zoomed}
          changesPanel={
            <EditorGrid
              tree={workbench.grid}
              focusedGroupId={workbench.activeGroup}
              onFocusGroup={workbench.focusGroup}
              onActivateTab={workbench.activate}
              onCloseTab={workbench.close}
              onSplit={workbench.split}
              onZoom={workbench.toggleZoom}
              zoomed={workbench.zoomed}
              renderTab={(tab) =>
                tab.kind === "welcome" ? (
                  <WelcomePlayground
                    version={CLIENT_VERSION}
                    quickActions={quickActions}
                    onComposingChange={onWelcomeComposingChange}
                    suspended={focusedPane !== "changes" || menuControl.openMenuId !== null}
                    theme={theme}
                  />
                ) : tab.fileView === "contents" ? (
                  <BareWorkbenchFileView
                    path={tab.path ?? ""}
                    controller={controller}
                    quickActions={quickActions}
                    onComposingChange={onWelcomeComposingChange}
                    onExit={() => {}}
                    theme={theme}
                  />
                ) : (
                  <GridTabContent
                    tab={tab}
                    rows={controller.rows()}
                    surface={bareSurface}
                    rejectedRows={EMPTY_ROWS}
                    dimmed={false}
                    readFile={(path) => controller.repoReadFile(path)}
                    onAddFileComment={(path, anchor, body) =>
                      void controller.commentOnWorkbench(
                        anchor,
                        { kind: "file", path, rev: "worktree" },
                        body,
                      )
                    }
                    theme={theme}
                  />
                )
              }
              theme={theme}
            />
          }
          projectPanel={
            <WelcomeProjectPanel
              mode={workbench.projectMode}
              controller={controller}
              onOpenChangedFile={openChangedFile}
              onOpenProjectFile={openProjectFile}
              focused={focusedPane === "project"}
              theme={theme}
            />
          }
          theme={theme}
        >
          {menuChrome}
          <ConfirmDialog
            isOpen={confirming !== null}
            title=" Delete plan "
            message={
              confirming
                ? `Delete "${confirming.title}"? This removes the plan and its review.`
                : ""
            }
            onConfirm={() => {
              if (confirming) controller.deleteSession(confirming.sessionId);
              setMode({ type: "normal" });
            }}
            onCancel={() => setMode({ type: "normal" })}
            theme={theme}
          />
          {mode.type === "renameThread" ? (
            <PromptDialog
              isOpen
              title=" rename thread "
              label="new title for this thread:"
              value={mode.text}
              placeholder="a short title"
              onInput={(text) => setMode({ ...mode, text })}
              onSave={() => {
                controller.renameSession(mode.sessionId, mode.text.trim());
                setMode({ type: "normal" });
              }}
              onCancel={() => setMode({ type: "normal" })}
              theme={theme}
            />
          ) : null}
        </AppShell>
      </MenuControlProvider>
    </ThemeProvider>
  );
}

export function CompletionScreen(props: {
  theme: Theme;
  session: Thread;
  verdict: VerdictKind;
  completion: { phase: "prompt" } | { phase: "counting"; remaining: number };
  status: string;
}): React.ReactNode {
  const { theme, session, verdict, completion, status } = props;

  return (
    <ThemeProvider theme={theme}>
      <CompletionOverlay
        verdict={verdict}
        completion={completion}
        status={status}
        returnsTo={
          returnPaneFor(session.artifact.meta.herdrPane)
            ? (session.artifact.meta.agent ?? "the agent")
            : undefined
        }
      />
    </ThemeProvider>
  );
}

/** The words each tree prompt uses; enter with an empty summary moves back without one. */
const TREE_PROMPTS: Record<TreeAsk, { title: string; label: string; placeholder: string }> = {
  branch: { title: " Branch ", label: "Name for the new branch:", placeholder: "alt" },
  label: {
    title: " Checkpoint ",
    label: "Name for this checkpoint:",
    placeholder: "before the rewrite",
  },
  navigate: {
    title: " Move back ",
    label: "Summary of what you leave behind (optional):",
    placeholder: "tried a shorter plan",
  },
};

export function TrailingOverlays(props: {
  walking: boolean;
  walk: { index: number } | null;
  walkFileList: WalkFile[];
  viewedPaths: Set<string>;
  session: Thread;
  terminalWidth: number;
  theme: Theme;
  mode: Mode;
  toast: ToastState | null;
  setMode: Dispatch<SetStateAction<Mode>>;
  dispatch: (intent: Intent) => void;
}): React.ReactNode {
  const {
    walking,
    walk,
    walkFileList,
    viewedPaths,
    session,
    terminalWidth,
    theme,
    mode,
    toast,
    setMode,
    dispatch,
  } = props;

  return (
    <>
      {walking && walk !== null ? (
        <WalkWizard
          files={walkFileList}
          index={walk.index}
          viewedPaths={viewedPaths}
          note={
            walkFileList[walk.index] !== undefined
              ? noteForFile(session.annotations, walkFileList[walk.index]!.path)
              : undefined
          }
          terminalWidth={terminalWidth}
          onSubmitRequest={() => {
            dispatch({ type: "walkLeave" });
            dispatch({ type: "openSubmit" });
          }}
          onBack={() => dispatch({ type: "walkBack" })}
        />
      ) : null}
      {mode.type === "rename" ? (
        <PromptDialog
          isOpen
          title=" Rename author "
          label="Display name for this collaborator:"
          value={mode.text}
          placeholder="their name"
          onInput={(text) => setMode({ ...mode, text })}
          onSave={() => dispatch({ type: "confirmDialog" })}
          onCancel={() => setMode({ type: "normal" })}
          theme={theme}
        />
      ) : null}
      {mode.type === "renameThread" ? (
        <PromptDialog
          isOpen
          title=" rename thread "
          label="new title for this thread:"
          value={mode.text}
          placeholder="a short title"
          onInput={(text) => setMode({ ...mode, text })}
          onSave={() => dispatch({ type: "confirmDialog" })}
          onCancel={() => setMode({ type: "normal" })}
          theme={theme}
        />
      ) : null}
      {mode.type === "nameSelf" ? (
        <PromptDialog
          isOpen
          title=" Welcome "
          label="Your name (optional) - it attributes the notes you leave:"
          value={mode.text}
          placeholder="your name"
          onInput={(text) => setMode({ ...mode, text })}
          onSave={() => dispatch({ type: "confirmDialog" })}
          onCancel={() => setMode({ type: "normal" })}
          theme={theme}
        />
      ) : null}
      {mode.type === "treePrompt" ? (
        <PromptDialog
          isOpen
          title={TREE_PROMPTS[mode.ask].title}
          label={TREE_PROMPTS[mode.ask].label}
          value={mode.text}
          placeholder={TREE_PROMPTS[mode.ask].placeholder}
          onInput={(text) => setMode({ ...mode, text })}
          onSave={() => dispatch({ type: "confirmDialog" })}
          onCancel={() => setMode({ type: "normal" })}
          theme={theme}
        />
      ) : null}
      {toast ? <Toast title={toast.title} body={toast.body} theme={theme} /> : null}
    </>
  );
}
