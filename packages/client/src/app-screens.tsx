import React, { type Dispatch, type SetStateAction } from "react";
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
import { MenuBar } from "./components/MenuBar";
import { KeybindsDialog } from "./components/KeybindsDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { CompletionOverlay } from "./components/CompletionOverlay";
import { InboxList } from "./components/InboxList";
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
  menuOpen: boolean;
  menuDialog: "keybinds" | "settings" | null;
  status: string;
  theme: Theme;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setMenuDialog: Dispatch<SetStateAction<"keybinds" | "settings" | null>>;
  keybindsSections: CheatsheetSection[];
  settingsCategories: SettingsCategory[];
  settingsValues: SettingsValues;
  settingsNav: SettingsNav;
  onCategorySelect: (categoryId: string) => void;
  cycleSetting: (rowKey: string) => void;
}): React.ReactNode {
  const {
    menuOpen,
    menuDialog,
    status,
    theme,
    setMenuOpen,
    setMenuDialog,
    keybindsSections,
    settingsCategories,
    settingsValues,
    settingsNav,
    onCategorySelect,
    cycleSetting,
  } = props;

  return (
    <>
      <MenuBar
        open={menuOpen}
        version={CLIENT_VERSION}
        status={status}
        onToggle={() => setMenuOpen((isOpen) => !isOpen)}
        onSettings={() => {
          setMenuOpen(false);
          setMenuDialog("settings");
        }}
        onKeybinds={() => {
          setMenuOpen(false);
          setMenuDialog("keybinds");
        }}
        theme={theme}
      />
      {menuDialog === "keybinds" ? (
        <KeybindsDialog sections={keybindsSections} theme={theme} />
      ) : null}
      {menuDialog === "settings" ? (
        <SettingsDialog
          isOpen
          categories={settingsCategories}
          values={settingsValues}
          activeCategoryId={settingsNav.categoryId}
          activeRowIndex={settingsNav.rowIndex}
          activeZone={settingsNav.zone}
          onCategorySelect={onCategorySelect}
          onRowActivate={(row) => cycleSetting(row.key)}
          theme={theme}
        />
      ) : null}
    </>
  );
}

export function InboxScreen(props: {
  inbox: ReviewSession[];
  inboxCursor: number;
  mode: Mode;
  theme: Theme;
  controller: ReviewController;
  setMode: Dispatch<SetStateAction<Mode>>;
  menuChrome: React.ReactNode;
}): React.ReactNode {
  const { inbox, inboxCursor, mode, theme, controller, setMode, menuChrome } = props;
  const confirming = mode.type === "confirmDelete" ? mode : null;

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
        {/* mirrors the review header row: same box, position, and accent product
            word, with a " · resume" separator and no Edit/Share toolbar */}
        <box
          style={{ flexDirection: "row", height: 2, paddingTop: 1, backgroundColor: theme.panel }}
        >
          <box
            style={{
              height: 1,
              backgroundColor: theme.panel,
              paddingLeft: 1,
              flexDirection: "row",
            }}
          >
            <text>
              <span fg={theme.accent}>cueloop</span>
              <span fg={theme.textDim}> · resume</span>
            </text>
          </box>
          <box style={{ flexGrow: 1 }} />
        </box>
        <InboxList
          inbox={inbox}
          cursor={inboxCursor}
          onRequestDelete={(id, title) => setMode({ type: "confirmDelete", sessionId: id, title })}
        />
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
