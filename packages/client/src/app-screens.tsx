import React, { useState, type Dispatch, type SetStateAction } from "react";
import type { ReviewSession, VerdictKind } from "@cueloop/schema";
import { returnPaneFor } from "@cueloop/schema";
import type { Theme } from "./theme";
import type { Mode, TreeAsk } from "./intent-dispatch";
import type { Intent } from "./keymap";
import type { ReviewController, ToastState } from "./session-controller";
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
import { InboxList } from "./components/InboxList";
import { WelcomeSurface } from "./components/WelcomeSurface";
import { PanelColumn, FileTab } from "./components/PanelColumn";
import { IconButton } from "./components/primitives/IconButton";
import { NERD } from "./components/primitives/icons";
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
  pinnedIds: ReadonlySet<string>;
  onPin: (id: string) => void;
  onRename: (id: string, title: string) => void;
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
    pinnedIds,
    onPin,
    onRename,
  } = props;
  const confirming = mode.type === "confirmDelete" ? mode : null;
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(false);

  return (
    <ThemeProvider theme={theme}>
      <box
        style={{
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: theme.background,
        }}
      >
        <box style={{ flexGrow: 1, flexDirection: "row" }}>
          {sidebarOpen ? (
            <PanelColumn
              width={30}
              border="right"
              header={
                <box style={{ flexDirection: "row" }}>
                  <box onMouseUp={onOpenMenu} style={{ paddingRight: 2 }}>
                    <text fg={theme.textMuted}>{NERD.settings}</text>
                  </box>
                  <IconButton
                    glyph={NERD.sidebarLeft}
                    onPress={onToggleSidebar}
                    marginRight={2}
                    theme={theme}
                  />
                  <text fg={theme.accent}>cueloop</text>
                </box>
              }
              theme={theme}
            >
              <scrollbox style={{ flexGrow: 1 }} focused={false}>
                <InboxList
                  rows={rows}
                  cursor={inboxCursor}
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
              </scrollbox>
            </PanelColumn>
          ) : null}
          <PanelColumn
            header={
              !sidebarOpen ? (
                <box onMouseUp={onToggleSidebar} style={{ paddingRight: 1 }}>
                  <text fg={theme.textMuted}>{NERD.sidebarLeftOff}</text>
                </box>
              ) : (
                <text fg={theme.textDim}>Thread</text>
              )
            }
            theme={theme}
          >
            <box style={{ flexGrow: 1, paddingLeft: 2, paddingTop: 1 }}>
              <text fg={theme.textDim}>open a thread in the sidebar</text>
            </box>
          </PanelColumn>
          {welcomeOpen ? (
            <PanelColumn
              width={52}
              border="left"
              header={
                <FileTab
                  label="Welcome"
                  active
                  onClose={() => setWelcomeOpen(false)}
                  theme={theme}
                />
              }
              theme={theme}
            >
              <WelcomeSurface version={CLIENT_VERSION} theme={theme} />
            </PanelColumn>
          ) : null}
          <PanelColumn
            width={30}
            border="left"
            header={<FileTab label="Project" theme={theme} />}
            headerRight={
              <box style={{ flexDirection: "row" }}>
                <IconButton
                  glyph={NERD.diff}
                  active={!changesOpen}
                  onPress={() => setChangesOpen(false)}
                  marginRight={1}
                  theme={theme}
                />
                <IconButton
                  glyph={NERD.listTree}
                  active={changesOpen}
                  onPress={() => setChangesOpen(true)}
                  marginRight={1}
                  theme={theme}
                />
                <IconButton glyph={NERD.expand} onPress={() => {}} marginRight={1} theme={theme} />
                <IconButton glyph={NERD.sidebarRight} onPress={() => {}} theme={theme} />
              </box>
            }
            theme={theme}
          >
            <box style={{ flexGrow: 1, paddingLeft: 1, paddingTop: 1 }}>
              <text fg={theme.textDim}>No changes</text>
            </box>
          </PanelColumn>
        </box>
        {menuChrome}
        <ConfirmDialog
          isOpen={confirming !== null}
          title=" Delete plan "
          message={
            confirming ? `Delete "${confirming.title}"? This removes the plan and its review.` : ""
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
            theme={theme}
          />
        ) : null}
      </box>
    </ThemeProvider>
  );
}

export function CompletionScreen(props: {
  theme: Theme;
  session: ReviewSession;
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
  session: ReviewSession;
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
          theme={theme}
        />
      ) : null}
      {toast ? <Toast title={toast.title} body={toast.body} theme={theme} /> : null}
    </>
  );
}
