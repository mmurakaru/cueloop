import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { Clock } from "@opentui/core";
import { marksByDisplay, type Mark } from "./view-plan";
import {
  DEFAULT_KEYS,
  DEFAULT_QUICK_ACTIONS,
  loadConfig,
  persistAuthorName,
  persistDiffView,
  persistIdentity,
  persistPins,
  type AutoClose,
  type DiffViewMode,
  type IdentityConfig,
  type QuickAction,
} from "./config";
import { resolveDisplayName } from "./attribution";
import { resolveGithubIdentity } from "./github-identity";
import { loadSkills, PaletteNamesContext, SlashSkillsContext } from "./skills";
import { mergeSlashItems, slashItemsFrom, type SlashItem } from "./slash-palette";
import {
  composeTheme,
  DEFAULT_THEME_NAME,
  themeForName,
  type Appearance,
  type ThemeName,
} from "./theme-presets";
import type { Theme } from "./theme";
import { createReviewController, type ShareTransport } from "./thread-controller";
import type { SessionClient } from "@cueloop/daemon/client";
import { createIntentDispatch, type Mode, type RailTab } from "./intent-dispatch";
import { reduceKey, type KeyState } from "./keymap";
import { KeyBindings, type CheatsheetSection } from "./key-bindings";
import { useReadySignal } from "./ready-signal";
import { ThemeProvider } from "./components/theme-context";
import { Button } from "./components/primitives/Button";
import { ShareChoiceDialog, SHARE_CHOICES } from "./components/ShareChoiceDialog";
import { Toolbar } from "./components/primitives/Toolbar";
import { groupInbox, projectName, threadTitle } from "./components/session-tree";
import { ThreadTree } from "./components/ThreadTree";
import { ChangesFileTree } from "./components/ChangesColumn";
import { MenuControlProvider, useMenuControlState } from "./components/menu-control";
import { ProjectTreeView } from "./components/ProjectTreeView";
import { AppShell, type FocusPane, type ProjectPanelMode } from "./components/AppShell";
import { EditorGrid } from "./components/EditorGrid";
import { GridTabContent } from "./components/GridTabContent";
import { useChangesWorkbench } from "./use-changes-workbench";
import { useRememberLayout } from "./use-remember-layout";
import type { LaunchLayout } from "./launch-layout";
import { ThreadFooter } from "./components/ThreadFooter";
import { ConfirmCard } from "./components/ConfirmCard";
import { ManageAccessDialog } from "./components/ManageAccessDialog";
import { THREAD_VIEW_CHEATSHEET, ThreadView } from "./components/ThreadView";
import {
  diffChordEntries,
  dispatchLeaderCommand,
  leaderCombosFor,
  leaderHint,
  matchesLeader,
  railChordEntries,
  resolveThreadChord,
  THREAD_CHORD_ENTRIES,
  treeChordEntries,
} from "./thread-chords";
import { type DiffFoldControls } from "./components/DiffContentView";
import { commentCountsByFile } from "./view-diff";
import { annotationTarget } from "@cueloop/schema";
import type { Annotation, Artifact, DiffFileContents, Identity, Thread } from "@cueloop/schema";
import { PrototypePixels } from "./prototype-pixels";
import type { PrototypeElement } from "./prototype-browser";
import {
  buildRenderFlags,
  buildSubmitConfirmState,
  computeRoleCapabilities,
  deriveReviewFlags,
  isPixelPrototypeMode,
  isCompletionOverlayPhase,
  isWalking,
  resolveOverlay,
} from "./app-view-model";
import { buildKeyState } from "./app-key-state";
import { useSettingsDialog } from "./use-settings-dialog";
import {
  CompletionScreen,
  ConnectingScreen,
  ErrorScreen,
  MenuChrome,
  NoThreadShell,
  TrailingOverlays,
} from "./app-screens";
/** A toast clears itself after this idle; esc dismisses it sooner. */
const TOAST_DISMISS_MS = 2000;

export interface AppProps {
  home?: string;
  sessionId?: string;
  /** The launch directory whose git repo backs the no-session welcome tree; defaults to process.cwd(). */
  cwd?: string;
  /**
   * Observer mode (SSH-served connections): every mutating primitive is ignored and
   * answers "observer - read-only" in the status line; navigation still works.
   */
  readOnly?: boolean;
  onExit?: (code: number) => void;
  /** Fired once, after the first frame that paints a usable screen with its keyboard handlers live (ready-signal.ts). */
  onReady?: () => void;
  /** Timer source for the auto-close countdown; tests inject a ManualClock. */
  clock?: Clock;
  /** Session source; the sharing gateway injects a blob-backed client. */
  openClient?: () => Promise<SessionClient>;
  shareTransport?: ShareTransport;
  /**
   * Who is at the keyboard. `owner` is the local planner (default). `observer`
   * is a passive `cueloop serve` watcher (read-only). `collaborator` is a share
   * viewer: annotates, but cannot edit the plan or submit an agent verdict.
   */
  role?: "owner" | "observer" | "collaborator";
  /**
   * A collaborator's own SSH fingerprint. On first open of a share it seeds the
   * name prompt so their notes attribute to a name, not a fingerprint.
   */
  selfAuthor?: string;
  /**
   * The terminal's background appearance (from an OSC query at startup). The
   * branded transparent theme darkens its text on a light terminal so it is not
   * light-on-light. Defaults to dark - the historical assumption.
   */
  appearance?: Appearance;
  /** The pane composition to open in; a create-command sets it, a bare launch restores the remembered one. */
  layout?: LaunchLayout;
  /** Serve mode: the frozen working-tree diff an observer reads for the served workbench thread. */
  servedArtifact?: Artifact;
}

/** True while the drop-up or one of its dialogs is open and owns the keyboard. */
function menuChromeOpen(menuDialog: "keybinds" | "settings" | null): boolean {
  return menuDialog !== null;
}

/** The private-share allowlist for a session, or an empty list for a public one. */
function allowedGithubLogins(session: Thread | null): string[] {
  return session?.access?.githubLogins ?? [];
}

/** The drop-up chrome or a floating popover menu (thread actions, editor split) holds the keyboard. */
function keyboardHeldByMenu(
  menuDialog: "keybinds" | "settings" | null,
  openMenuId: string | null,
): boolean {
  return menuChromeOpen(menuDialog) || openMenuId !== null;
}

/** A non-modal toast: escape dismisses it only when nothing else owns escape (no overlay, not span mode). */
export function toastDismissRequested(
  toastOpen: boolean,
  key: { name: string },
  overlay: KeyState["overlay"],
  spanMode: boolean,
): boolean {
  return toastOpen && key.name === "escape" && overlay === "none" && !spanMode;
}

/** ctrl+q quits from anywhere, ahead of every focus/menu/overlay gate, with no confirmation. */
export function quitKeyHandled(
  key: { name: string; ctrl?: boolean },
  onExit?: (code: number) => void,
): boolean {
  if (!key.ctrl || key.name !== "q") return false;
  onExit?.(0);

  return true;
}

/** A popover menu is open, so the shell keyboard is modal: escape closes it, every other key is swallowed. */
function menuModalHandled(
  menuControl: { openMenuId: string | null; closeMenu: () => void },
  key: { name: string },
): boolean {
  if (menuControl.openMenuId === null) return false;
  if (key.name === "escape") menuControl.closeMenu();

  return true;
}

/** True while a menu or an overlay owns the keyboard instead of the thread view. */
function keyboardOwnedElsewhere(menuOwnsKeyboard: boolean, overlay: KeyState["overlay"]): boolean {
  return menuOwnsKeyboard || overlay !== "none";
}

/** The highlighted share option, or the public default when the choice is closed. */
function shareChoiceIndex(mode: Mode): number {
  return mode.type === "shareChoice" ? mode.index : 0;
}

interface ShareChoiceActions {
  setMode: (mode: Mode) => void;
  isOwner: boolean;
  publish: () => void;
  openManageAccess: () => void;
}

/** Move the share-choice highlight by one row, clamped to the list. */
function movedShareChoice(index: number, delta: number): Mode {
  const next = Math.min(SHARE_CHOICES.length - 1, Math.max(0, index + delta));

  return { type: "shareChoice", index: next };
}

/** Commit the highlighted share option: public publishes a link, private opens manage-access. */
function commitShareChoice(index: number, actions: ShareChoiceActions): void {
  const picked = SHARE_CHOICES[index]?.choice;

  actions.setMode({ type: "normal" });

  if (!actions.isOwner) return;

  if (picked === "private") actions.openManageAccess();
  else actions.publish();
}

/** Route one key to the open share choice: escape cancels, arrows move, enter commits. */
function handleShareChoiceKey(
  index: number,
  key: { name: string },
  actions: ShareChoiceActions,
): void {
  if (key.name === "escape") return actions.setMode({ type: "normal" });

  if (key.name === "down" || key.name === "j") return actions.setMode(movedShareChoice(index, 1));

  if (key.name === "up" || key.name === "k") return actions.setMode(movedShareChoice(index, -1));

  if (key.name === "return" || key.name === "enter") commitShareChoice(index, actions);
}

/**
 * An app-level dialog owns the keyboard while open: the manage-access dialog takes its own keys,
 * and the share choice moves the highlight, commits on enter, and cancels on escape. Returns true
 * when a dialog consumed the key so the caller stops the grammar.
 */
function appDialogOwnsKey(
  accessDialogOpen: boolean,
  mode: Mode,
  key: { name: string },
  actions: ShareChoiceActions,
): boolean {
  if (accessDialogOpen) return true;

  if (mode.type !== "shareChoice") return false;

  handleShareChoiceKey(mode.index, key, actions);

  return true;
}

/** The footer submit fires only for the owner of an unresolved review, never an observer. */
function canSubmitReview(isOwner: boolean, resolved: boolean, observer: boolean): boolean {
  return isOwner && !resolved && !observer;
}

/** The author display name for a comment's hover tooltip: the reviewer's own name for their notes, else the resolved collaborator name. */
function authorLabelResolver(
  ownName: string | undefined,
  participants: Identity[] | undefined,
  overrides: Record<string, string>,
): (annotation: Annotation) => string | undefined {
  return (annotation) =>
    annotation.author === undefined
      ? (ownName ?? "you")
      : resolveDisplayName(annotation.author, participants, overrides);
}

/** The Project pane body: the resolved repo's changed files in changes mode, its full tree otherwise. */
function ProjectPanelBody(props: {
  mode: ProjectPanelMode;
  loadChanges: () => Promise<readonly DiffFileContents[]>;
  loadProjectFiles: () => Promise<string[]>;
  reloadKey: string;
  onOpenChangedFile: (path: string) => void;
  onOpenProjectFile: (path: string) => void;
  commentCounts?: ReadonlyMap<string, number>;
  focused?: boolean;
  theme: Theme;
}): React.ReactNode {
  const [changes, setChanges] = useState<readonly DiffFileContents[]>([]);
  const loadRef = useRef(props.loadChanges);
  useEffect(() => {
    loadRef.current = props.loadChanges;
  });
  useEffect(() => {
    let alive = true;

    void loadRef.current().then(
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
  }, [props.reloadKey, props.mode]);

  if (props.mode === "changes") {
    return (
      <ChangesFileTree
        files={changes}
        onSelectFile={props.onOpenChangedFile}
        commentCounts={props.commentCounts}
        focused={props.focused}
        theme={props.theme}
      />
    );
  }
  return (
    <ProjectTreeView
      key={props.reloadKey}
      loadFiles={props.loadProjectFiles}
      onSelectFile={props.onOpenProjectFile}
      focused={props.focused}
      theme={props.theme}
    />
  );
}

/** The render tree has left the connecting screen: an error, a session, or the no-thread shell. */
function usableScreenReached(
  error: string | null,
  session: Thread | null,
  inbox: Thread[] | null,
): boolean {
  return Boolean(error) || session !== null || inbox !== null;
}

/** The keybinds dialog content: the thread grammar while the thread view owns the keys. */
function cheatsheetFor(
  keyBindings: KeyBindings,
  threadViewActive: boolean,
  hint: string,
): CheatsheetSection[] {
  const base = keyBindings.cheatsheet();

  if (!threadViewActive) {
    return base;
  }

  return [
    ...THREAD_VIEW_CHEATSHEET,
    { title: "Session", entries: [...THREAD_CHORD_ENTRIES] },
    { title: "Diff", entries: diffChordEntries(hint) },
    { title: "Rail", entries: railChordEntries(hint) },
    { title: "Tree", entries: treeChordEntries(hint) },
    ...base.filter((section) => section.title === "Agent terminal"),
  ];
}

/** The Threads sidebar opens from the launch layout; a bare launch opens it only on the inbox. */
function initialThreadsOpen(
  layout: LaunchLayout | undefined,
  sessionId: string | undefined,
): boolean {
  return layout ? layout.threads : sessionId === undefined;
}

function initialFocusedPane(sessionId: string | undefined, zoomed: boolean): FocusPane {
  if (sessionId === undefined) return "threads";

  return zoomed ? "changes" : "thread";
}

function bareShellDefersKeys(
  sessionIsNull: boolean,
  overlayIsNone: boolean,
  focusedPane: FocusPane,
): boolean {
  return sessionIsNull && overlayIsNone && focusedPane !== "threads";
}

function surfaceSuspended(base: boolean, focusedPane: FocusPane, pane: FocusPane): boolean {
  return base || focusedPane !== pane;
}

export function threadsNavHandled(params: {
  focusedPane: FocusPane;
  quiet: boolean;
  key: { name: string };
  count: number;
  setInboxCursor: (update: (cursor: number) => number) => void;
  openSession: () => void;
}): boolean {
  const { focusedPane, quiet, key, count } = params;

  if (focusedPane !== "threads" || !quiet || count === 0) return false;
  if (key.name === "j" || key.name === "down") {
    params.setInboxCursor((cursor) => Math.min(cursor + 1, count - 1));

    return true;
  }
  if (key.name === "k" || key.name === "up") {
    params.setInboxCursor((cursor) => Math.max(cursor - 1, 0));

    return true;
  }
  if (key.name === "return" || key.name === "enter") {
    params.openSession();

    return true;
  }

  return false;
}

export function appLeaderHandled(params: {
  focusedPane: FocusPane;
  key: { name: string; shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean };
  leaderCombos: readonly string[];
  pending: { current: boolean };
  runLeaderCommand: (key: { name: string; shift?: boolean }) => void;
}): boolean {
  const { focusedPane, key, leaderCombos, pending, runLeaderCommand } = params;

  if (focusedPane !== "threads" && focusedPane !== "project") return false;
  if (pending.current) {
    pending.current = false;
    if (key.name !== "escape") runLeaderCommand(key);

    return true;
  }
  if (matchesLeader(key, leaderCombos)) {
    pending.current = true;

    return true;
  }

  return false;
}

export function visiblePanes(
  sidebarOpen: boolean,
  threadShown: boolean,
  changesOpen: boolean,
  projectOpen: boolean,
): FocusPane[] {
  const panes: FocusPane[] = [];

  if (sidebarOpen) panes.push("threads");
  if (threadShown) panes.push("thread");
  if (changesOpen) panes.push("changes");
  if (projectOpen) panes.push("project");

  return panes;
}

export function nextFocusPane(
  current: FocusPane,
  panes: FocusPane[],
  backward: boolean,
): FocusPane {
  if (panes.length === 0) return current;
  const index = panes.indexOf(current);
  const step = backward ? -1 : 1;

  return panes[(index + step + panes.length) % panes.length] ?? current;
}

/** The panes that can own the keyboard: a diff's Thread pane is an inert placeholder, so it is out. */
function navigableFocusPanes(
  sidebarOpen: boolean,
  zoomed: boolean,
  isDiff: boolean,
  changesOpen: boolean,
  projectOpen: boolean,
): FocusPane[] {
  return visiblePanes(sidebarOpen, !zoomed && !isDiff, changesOpen, projectOpen);
}

/** The layout hid or inert-ed the focused pane: fall back to the first navigable one, else stay put. */
export function reconciledFocus(navigable: FocusPane[], focusedPane: FocusPane): FocusPane | null {
  if (navigable.length === 0 || navigable.includes(focusedPane)) return null;

  return navigable[0] ?? null;
}

export function App({
  home,
  sessionId,
  cwd,
  readOnly = false,
  onExit,
  onReady,
  clock,
  openClient,
  shareTransport,
  role = "owner",
  selfAuthor,
  appearance = "dark",
  layout,
  servedArtifact,
}: AppProps): React.ReactNode {
  const { observer, isOwner } = computeRoleCapabilities(readOnly, role);
  const controller = useMemo(
    () =>
      createReviewController({
        home,
        sessionId,
        cwd,
        readOnly: observer,
        onExit,
        clock,
        openClient,
        shareTransport,
        servedArtifact,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, sessionId],
  );

  useEffect(() => {
    controller.connect();

    return () => controller.close();
  }, [controller]);
  // stable across renders so the memoized PrototypeContentView is not
  // re-rendered by unrelated App state (status ticks, a rail-width drag)
  const onCommentPrototype = useCallback(
    (element: PrototypeElement, body: string) =>
      controller.annotatePrototype(element.selector, element.quote, body),
    [controller],
  );
  const { session, inbox, status, toast, error, completion, editOrphanCount, walk } =
    useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  // A shared plan you own polls for collaborator notes while it is open; the
  // merge refreshes through the normal event path. Stops on leave.
  useEffect(() => {
    if (!isOwner || !session?.shareId) return;

    return controller.startShareSync();
  }, [isOwner, session?.id, session?.shareId, controller]);
  const renderer = useRenderer();
  const { width: terminalWidth } = useTerminalDimensions();

  // ── view state ──────────────────────────────
  const [cursor, setCursor] = useState(0);
  const [inboxCursor, setInboxCursor] = useState(0);
  // Projects and Threads grouping; ordered is the flat sequence the inbox cursor walks
  // pinned threads are client-local view state, seeded from the user config and
  // persisted on toggle; a pin lifts the thread into the sidebar's Pinned section
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const grouped = useMemo(() => groupInbox(inbox ?? [], pinnedIds), [inbox, pinnedIds]);
  const togglePin = (id: string): void =>
    setPinnedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistPins([...next]);

      return next;
    });
  // the left Projects and Threads column; collapsed by default per the context
  // matrix (the thread owns the width), toggled open to jump between threads
  // one sidebar-open state across the no-thread shell and the thread view, so
  // picking a thread keeps the sidebar as it was. It opens when the app lands with
  // nothing selected (pick a thread) and stays collapsed on a direct thread open,
  // where the thread owns the width.
  const [sidebarOpen, setSidebarOpen] = useState(() => initialThreadsOpen(layout, sessionId));
  // the Changes + Project right region and its editor grid (tabs, splits, zoom)
  const workbench = useChangesWorkbench({ layout });
  const [focusedPane, setFocusedPane] = useState<FocusPane>(() =>
    initialFocusedPane(sessionId, workbench.zoomed),
  );
  // only the session view persists from here; the bare shell owns its own (NoThreadShell), so this
  // workbench stays inactive with no session and never clobbers what the shell saved
  useRememberLayout(
    layout,
    session !== null,
    sidebarOpen,
    workbench.changesOpen,
    workbench.projectOpen,
    workbench.zoomed,
  );
  const [mode, setMode] = useState<Mode>({ type: "normal" });
  // the top-left settings gear drop-down and the centered dialog it opens
  const [menuDialog, setMenuDialog] = useState<"keybinds" | "settings" | null>(null);
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);
  const [autoClose, setAutoClose] = useState<AutoClose>("off");
  // unified or side-by-side diff; split only lays out when the Changes pane is zoomed
  const [diffView, setDiffView] = useState<DiffViewMode>("split");
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | undefined>(undefined);
  const [selectedCurationId, setSelectedCurationId] = useState<string | undefined>(undefined);
  const [railTab, setRailTab] = useState<RailTab>("review");
  // the tree row the reviewer stands on in the session tree
  const [selectedEntryId, setSelectedEntryId] = useState<string | undefined>(undefined);
  // ~2s focus pulse on the document highlight when a card is activated
  const [pulsedAnnotationId, setPulsedAnnotationId] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // live mirror of overlay input text: refs commit synchronously, so the
  // RETURN handler never reads a stale value mid-typing
  const liveInput = useRef("");
  // keymap from layered config; the loaded theme swaps the provider value
  const keysRef = useRef(DEFAULT_KEYS);
  const keyBindings = useMemo(() => new KeyBindings(DEFAULT_KEYS), []);
  const [theme, setTheme] = useState(() => themeForName(DEFAULT_THEME_NAME, appearance));
  const [themeName, setThemeName] = useState<ThemeName>(DEFAULT_THEME_NAME);
  const [themeOverrides, setThemeOverrides] = useState<Partial<Theme>>({});
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const [identity, setIdentity] = useState<IdentityConfig>({ provider: "typed" });
  const [quickActions, setQuickActions] = useState<QuickAction[]>(DEFAULT_QUICK_ACTIONS);
  const [skills, setSkills] = useState<SlashItem[]>([]);
  const paletteNames = useMemo(
    () => new Set(mergeSlashItems(slashItemsFrom(quickActions), skills).map((item) => item.name)),
    [quickActions, skills],
  );
  // opt-in: render a prototype as a kitty pixel mockup instead of the markdown doc
  const [prototypePixels, setPrototypePixels] = useState(false);

  useEffect(() => {
    const config = loadConfig({ repoRoot: session?.workspace.repoRoot });

    setPrototypePixels(config.experimental.prototypePixels);
    keysRef.current = config.keys;
    keyBindings.setKeys(config.keys);
    setTheme(composeTheme(config.ui.theme, config.themeOverrides, appearance));
    setThemeName(config.ui.theme);
    setThemeOverrides(config.themeOverrides);
    setAuthorNames(config.authors);
    setIdentity(config.identity);
    setQuickActions(config.actions);
    setSkills(loadSkills(config.skillsPath));
    setAutoClose(config.ui.autoClose);
    setDiffView(config.ui.diffView);
    setPinnedIds(new Set(config.ui.pins));
    controller.applyConfig(config);
  }, [session?.workspace.repoRoot, controller, keyBindings, appearance]);
  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => controller.dismissToast(), TOAST_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [toast, controller]);

  // First open of a share: ask the collaborator for a display name once, unless
  // a past visit already recorded one. esc skips and their notes read anonymous.
  const promptedSelfRef = useRef(false);

  useEffect(() => {
    if (promptedSelfRef.current || role !== "collaborator" || !selfAuthor || !session) return;
    promptedSelfRef.current = true;
    const known = session.participants?.find((participant) => participant.id === selfAuthor)?.name;

    if (!known) setMode({ type: "nameSelf", text: "" });
  }, [role, selfAuthor, session]);

  // Bumped on every identity change so a slow GitHub sync that lands after a newer rename is discarded.
  const identityGenerationRef = useRef(0);
  const applyIdentity = (next: IdentityConfig): void => {
    identityGenerationRef.current += 1;
    setIdentity(next);
    try {
      persistIdentity(next);
    } catch {
      controller.setStatus("could not save identity to config");
    }
  };
  const syncGithubIdentity = (): void => {
    const generation = (identityGenerationRef.current += 1);
    void resolveGithubIdentity().then((github) => {
      if (identityGenerationRef.current !== generation) return;
      if (!github) return controller.setStatus("GitHub not connected - run gh auth login");
      const name = github.name?.trim() || github.login;

      applyIdentity({ name, provider: "github" });
      controller.setStatus(`identity synced from GitHub - ${name}`);
    });
  };

  // ── settings dialog: config-backed model, navigation, persistence ──
  const {
    settingsNav,
    settingsCategories,
    settingsValues,
    cycleSetting,
    handleSettingsKey,
    onCategorySelect,
  } = useSettingsDialog({
    theme,
    appearance,
    autoClose,
    setAutoClose,
    diffView,
    setDiffView,
    themeName,
    setThemeName,
    themeOverrides,
    setTheme,
    quickActions,
    setQuickActions,
    setMenuDialog,
    identityName: identity.name,
    identityProvider: identity.provider,
    onSyncGithubIdentity: syncGithubIdentity,
    onRenameDisplayName: () => {
      setMenuDialog(null);
      setMode({ type: "renameSelf", text: identity.name ?? "" });
    },
  });

  // ── derived view model ──────────────────────
  const display = controller.display();
  const rows = controller.rows();
  const rejectedRows = controller.rejectedRows();
  const marks = useMemo(
    () =>
      session
        ? marksByDisplay(
            // the plan thread shows only artifact notes; Changes-diff notes render on that surface
            session.annotations.filter(
              (annotation) => annotationTarget(annotation).kind === "artifact",
            ),
            display,
            pulsedAnnotationId ?? undefined,
          )
        : new Map<number, Mark[]>(),
    [session, display, pulsedAnnotationId],
  );
  /** Annotation ids whose anchor resolved against the working copy. */
  const resolvedIds = useMemo(() => {
    const ids = new Set<string>();

    for (const blockMarks of marks.values()) {
      for (const mark of blockMarks) if (mark.annotationId) ids.add(mark.annotationId);
    }

    return ids;
  }, [marks]);
  const { isDiff, isPrototype, resolved } = deriveReviewFlags(session);
  // a prototype is a markdown design doc by default; only the opt-in experimental
  // pixel mode (flag on + an HTML entry) renders it as a kitty mockup instead
  const isPixelPrototype = isPixelPrototypeMode(
    isPrototype,
    prototypePixels,
    session?.artifact.meta.prototypePath,
  );
  // comments per changed-file path, for the changed-files tree and tab badges
  const diffCommentCounts = useMemo(
    () => (session && isDiff ? commentCountsByFile(session, rows) : undefined),
    [session, isDiff, rows],
  );
  // entering a diff opens the right region in changed-files mode; a plan or reply opens it closed
  workbench.syncSession(session?.id, isDiff);
  // plans, replies, and the default (markdown) prototype open in the thread view, diffs in the
  // diff sheet: both drive the shared annotation surface; only the pixel prototype keeps the keymap
  const threadViewActive = session !== null && !isPixelPrototype;
  const [threadComposing, setThreadComposing] = useState(false);
  const [prototypeComposing, setPrototypeComposing] = useState(false);
  const [welcomeComposing, setWelcomeComposing] = useState(false);
  // sort position per annotation so the rail interleaves annotation and removal
  // cards in one line-ordered stack: a diff row carries its blockIndex; a plan
  // annotation resolves to the display index it marked
  // ── the guided walk's view model ────────────
  const walkFileList = controller.files();
  const walking = isWalking(isDiff, walk);
  const viewedPaths = useMemo(() => new Set(session?.viewedPaths ?? []), [session]);

  // ── selection symmetry: one selected id, both sides ──
  const selectCardFromDocument = (annotationId: string): void => {
    setFocusedAnnotationId(annotationId);
  };

  const openCardEdit = (annotationId: string): void => {
    if (observer) return controller.setStatus("observer - read-only");
    const annotation = session?.annotations.find((candidate) => candidate.id === annotationId);

    if (!annotation) return;
    // a collaborator's note is theirs to word: activating it (click or e) renames
    // the author rather than editing the body the planner does not own
    if (annotation.author) {
      setFocusedAnnotationId(annotationId);

      return void setMode({
        type: "rename",
        authorId: annotation.author,
        text: authorNames[annotation.author] ?? "",
      });
    }
    if (resolved) return controller.setStatus("review submitted - read-only");
    liveInput.current = annotation.body;
    setMode({ type: "railEdit", id: annotation.id, text: annotation.body });
  };

  /** The $EDITOR hand-off releases the terminal: suspend, edit, resume. */
  const runEditorHandOff = (): void => {
    renderer?.suspend();
    try {
      controller.edit();
    } finally {
      renderer?.resume();
    }
  };

  // ── keyboard grammar: build state, reduce, dispatch ──
  const dispatch = createIntentDispatch({
    controller,
    onExit,
    isDiff,
    display,
    rows,
    cursor,
    inbox: inbox === null ? null : grouped.ordered,
    inboxCursor,
    mode,
    session,
    focusedAnnotationId,
    selectedCurationId,
    railTab,
    selectedEntryId,
    authorNames,
    quickActions,
    renameAuthor: (id: string, name: string) => {
      persistAuthorName(id, name);
      setAuthorNames((prev) => ({ ...prev, [id]: name }));
    },
    renameThread: (id: string, title: string) => controller.renameSession(id, title),
    setLocalIdentityName: (name: string) => {
      applyIdentity(name ? { name, provider: "typed" } : { provider: "typed" });
    },
    liveInput,
    setCursor,
    setInboxCursor,
    setMode,
    setRailTab,
    setSelectedEntryId,
    setFocusedAnnotationId,
    setSelectedCurationId,
    setPulsedAnnotationId,
    selectCardFromDocument,
    runEditorHandOff,
    openCardEdit,
    toggleDiffView: () => {
      const next: DiffViewMode = diffView === "stacked" ? "split" : "stacked";

      setDiffView(next);
      persistDiffView(next);
      // every toggle names the new mode; picking split on a narrow pane also says it needs the wide layout
      if (next === "stacked") controller.setStatus("stacked diff");
      else if (workbench.zoomed) controller.setStatus("split diff");
      else controller.setStatus("split diff shows when zoomed");
    },
  });

  const overlay = resolveOverlay(mode, completion.phase, walking);

  const menuControl = useMenuControlState();
  const menuOwnsKeyboard = keyboardHeldByMenu(menuDialog, menuControl.openMenuId);
  // an overlay (submit, walk, prompt, confirm, share choice) or the menu takes the
  // keyboard from the thread view; the view suspends its own grammar meanwhile
  const threadViewSuspended = keyboardOwnedElsewhere(menuOwnsKeyboard, overlay);

  const leaderCombos = leaderCombosFor(keysRef.current.leader);
  const leaderPending = useRef(false);
  const navigablePanes = navigableFocusPanes(
    sidebarOpen,
    workbench.zoomed,
    isDiff,
    workbench.changesOpen,
    workbench.projectOpen,
  );
  useEffect(() => {
    // the bare shell drives its panes from its own workbench, so only reconcile against this one
    if (!session) return;
    const next = reconciledFocus(navigablePanes, focusedPane);

    if (next) setFocusedPane(next);
  }, [session, navigablePanes, focusedPane]);
  const cyclePanes = (backward: boolean): void =>
    setFocusedPane((current) => nextFocusPane(current, navigablePanes, backward));
  const runLeaderCommand = (key: { name: string; shift?: boolean }): void => {
    if (key.name === "tab") return cyclePanes(Boolean(key.shift));

    dispatchLeaderCommand(
      key,
      { composing: threadComposing, isOwner, resolved, treeActive: railTab === "tree", isDiff },
      dispatch,
    );
  };
  // clicking a sidebar thread moves the cursor onto it too, so the row shows its selected backdrop at once
  const openThread = (id: string): void => {
    const index = grouped.ordered.findIndex((thread) => thread.id === id);

    if (index >= 0) setInboxCursor(() => index);
    controller.open(id);
  };

  useKeyboard((key) => {
    if (quitKeyHandled(key, onExit)) return;
    // an app-level dialog (manage-access, share choice) owns the keyboard while open
    if (
      appDialogOwnsKey(accessDialogOpen, mode, key, {
        setMode,
        isOwner,
        publish: () => controller.share(),
        openManageAccess: () => setAccessDialogOpen(true),
      })
    )
      return;
    if (menuModalHandled(menuControl, key)) return;
    if (
      appLeaderHandled({ focusedPane, key, leaderCombos, pending: leaderPending, runLeaderCommand })
    )
      return;
    if (
      threadsNavHandled({
        focusedPane,
        quiet: overlay === "none" && !menuOwnsKeyboard && !threadComposing,
        key,
        count: grouped.ordered.length,
        setInboxCursor,
        openSession: () => dispatch({ type: "openSession" }),
      })
    )
      return;
    // The thread view owns the document grammar while active (its own
    // useKeyboard handles marks, comments, and ctrl+q); the session chords
    // (submit, share, edit, walk, the rail) resolve here, and the keymap only
    // sees keys while an overlay or the menu owns them.
    if (threadViewActive && !threadViewSuspended) {
      const chord = resolveThreadChord(key, {
        composing: threadComposing,
        isOwner,
        resolved,
        treeActive: railTab === "tree",
        isDiff,
      });

      if (chord) dispatch(chord);

      return;
    }
    // A compose textarea owns the keyboard while open: let it receive the typed note instead of the
    // global keymap acting on each letter (the prototype, and the bare-shell welcome playground).
    if (prototypeComposing || welcomeComposing) return;
    if (menuDialog === "settings") return void handleSettingsKey(key.name);
    if (menuDialog) return void (key.name === "escape" && setMenuDialog(null));
    // the toast is non-modal: escape only dismisses it when nothing else owns
    // escape, so an open overlay (compose, submit, prompt, walk) still cancels
    if (toastDismissRequested(toast !== null, key, overlay, mode.type === "span"))
      return controller.dismissToast();
    if (bareShellDefersKeys(session === null, overlay === "none", focusedPane)) return;
    const state = buildKeyState({
      keys: keysRef.current,
      observer,
      isOwner,
      overlay,
      session,
      isDiff,
      mode,
      resolved,
      inbox,
      focusedAnnotationId,
      walk,
      walkFileList,
      rows,
      cursor,
      display,
    });

    keyBindings.setContext({
      overlay: state.overlay,
      spanMode: state.spanMode,
    });
    const action = keyBindings.resolveAction({
      name: key.name,
      shift: !!key.shift,
    });

    for (const intent of reduceKey(
      state,
      { name: key.name, shift: !!key.shift, meta: !!key.meta },
      action,
    ))
      dispatch(intent);
  });

  // after every keyboard hook above, so their subscriptions precede the signal
  useReadySignal(usableScreenReached(error, session, inbox), onReady);

  // ── shared bottom chrome: the menu bar and its drop-up dialogs, one render
  // reused by the inbox and by plan/diff review so the two never drift ──
  const menuChrome = (
    <MenuChrome
      menuDialog={menuDialog}
      theme={theme}
      keybindsSections={cheatsheetFor(keyBindings, threadViewActive, leaderHint(leaderCombos))}
      settingsCategories={settingsCategories}
      settingsValues={settingsValues}
      settingsNav={settingsNav}
      onCategorySelect={onCategorySelect}
      cycleSetting={cycleSetting}
      onClose={() => setMenuDialog(null)}
    />
  );

  // ── render ──────────────────────────────────
  if (error) return <ErrorScreen error={error} theme={theme} />;
  if (!session)
    return inbox ? (
      <SlashSkillsContext.Provider value={skills}>
        <PaletteNamesContext.Provider value={paletteNames}>
          <NoThreadShell
            rows={grouped.rows}
            inboxCursor={inboxCursor}
            onOpenThread={openThread}
            mode={mode}
            theme={theme}
            controller={controller}
            setMode={setMode}
            menuChrome={menuChrome}
            onOpenMenu={() => setMenuDialog("settings")}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            focusedPane={focusedPane}
            onFocusPane={setFocusedPane}
            menuControl={menuControl}
            pinnedIds={pinnedIds}
            onPin={togglePin}
            onRename={(id, title) => setMode({ type: "renameThread", sessionId: id, text: title })}
            quickActions={quickActions}
            onWelcomeComposingChange={setWelcomeComposing}
            layout={layout}
          />
        </PaletteNamesContext.Provider>
      </SlashSkillsContext.Provider>
    ) : (
      <ConnectingScreen theme={theme} />
    );

  const activeSession = session;
  const resolveAuthorLabel = authorLabelResolver(
    identity.name,
    activeSession.participants,
    authorNames,
  );

  if (isCompletionOverlayPhase(completion) && activeSession.verdict)
    return (
      <CompletionScreen
        theme={theme}
        session={activeSession}
        verdict={activeSession.verdict.kind}
        completion={completion}
        status={status}
      />
    );

  const diffFold: DiffFoldControls = {
    isCollapsed: (file) => controller.isFileCollapsed(file),
    isExpanded: (file) => controller.isFileExpanded(file),
    canExpand: (file) => controller.canExpandFile(file),
    onToggleCollapse: (file) =>
      controller.setFileCollapsed(file, !controller.isFileCollapsed(file)),
    onToggleExpand: (file) => controller.setFileExpanded(file, !controller.isFileExpanded(file)),
    onCopyPath: (file) => controller.copyFilePath(file),
  };
  const submitConfirmState = buildSubmitConfirmState({
    mode,
    isDiff,
    session: activeSession,
    walkFileList,
    viewedPaths,
    liveInput,
    setMode,
    dispatch,
  });
  const { showOwnerActions, prototypeCanComment, chromeHidden, prototypePath } = buildRenderFlags({
    session: activeSession,
    isOwner,
    isDiff,
    isPixelPrototype,
    resolved,
    menuDialog,
    resolvedIds,
  });

  const onEditRequest = (): void => {
    // A share viewer/observer has no Edit affordance (the button is hidden), so
    // this is owner-only; stay silent rather than nag if it is ever reached.
    if (!isOwner) return;
    if (resolved) return controller.setStatus("review submitted - read-only");
    runEditorHandOff();
  };

  // the share choice's public option: publish the plan, copy the ssh line
  const onShareRequest = (): void => {
    if (!isOwner) return controller.setStatus("only the plan owner can share");
    controller.share();
  };

  // the share choice's private option opens the manage-access allowlist surface
  const onPrivateShareRequest = (): void => {
    if (!isOwner) return controller.setStatus("only the plan owner can share");
    setAccessDialogOpen(true);
  };
  const allowedLogins = allowedGithubLogins(session);

  // clicking the rail Submit button: same read-only answer as the submit key
  const onSubmitRequest = (): void => {
    if (observer) return controller.setStatus("observer - read-only");
    if (!isOwner) return controller.setStatus("shared view - your notes save as you go");
    if (resolved) return;
    dispatch({ type: "openSubmit" });
  };

  const threadFooter = (
    <ThreadFooter
      repo={projectName(activeSession.workspace)}
      branch={activeSession.workspace.branch}
      onSubmit={onSubmitRequest}
      canSubmit={canSubmitReview(isOwner, resolved, observer)}
      theme={theme}
    />
  );

  return (
    <SlashSkillsContext.Provider value={skills}>
      <PaletteNamesContext.Provider value={paletteNames}>
        <ThemeProvider theme={theme}>
          <MenuControlProvider value={menuControl}>
            <AppShell
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((open) => !open)}
              onOpenMenu={() => setMenuDialog("settings")}
              onFocusPane={setFocusedPane}
              threadsPanel={
                <scrollbox style={{ flexGrow: 1 }} focused={false}>
                  <ThreadTree
                    rows={grouped.rows}
                    cursor={inboxCursor}
                    activeId={activeSession.id}
                    focused={focusedPane === "threads"}
                    pinnedIds={pinnedIds}
                    width={30}
                    onSelect={openThread}
                    onPin={togglePin}
                    onRename={(id, title) =>
                      setMode({ type: "renameThread", sessionId: id, text: title })
                    }
                    theme={theme}
                  />
                </scrollbox>
              }
              threadTitle={threadTitle(activeSession)}
              threadActions={
                showOwnerActions ? (
                  <Toolbar>
                    <Button onPress={onEditRequest} theme={theme}>
                      {" edit "}
                    </Button>
                    <Button onPress={() => dispatch({ type: "share" })} theme={theme}>
                      {" share "}
                    </Button>
                  </Toolbar>
                ) : undefined
              }
              threadPanel={
                <box style={{ flexGrow: 1, flexDirection: "column" }}>
                  <box style={{ flexGrow: 1, flexDirection: "row" }}>
                    {isPixelPrototype ? (
                      <PrototypePixels
                        prototypePath={prototypePath}
                        canComment={prototypeCanComment}
                        onCommentElement={onCommentPrototype}
                        onComposingChange={setPrototypeComposing}
                        hidden={chromeHidden}
                      />
                    ) : isDiff ? (
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
                    ) : (
                      <ThreadView
                        session={activeSession}
                        suspended={surfaceSuspended(threadViewSuspended, focusedPane, "thread")}
                        editOrphanCount={editOrphanCount}
                        onComposingChange={setThreadComposing}
                        leaderCombos={leaderCombos}
                        onLeaderCommand={runLeaderCommand}
                        resolved={resolved}
                        onObserverBlocked={(reason) =>
                          controller.setStatus(
                            reason === "observer"
                              ? "observer - read-only"
                              : "review submitted - read-only",
                          )
                        }
                        onCursorChange={setCursor}
                        focusedAnnotationId={focusedAnnotationId}
                        onFocusAnnotation={setFocusedAnnotationId}
                        display={display}
                        marks={marks}
                        quickActions={quickActions}
                        observer={observer}
                        onAnnotate={(span, body) =>
                          void controller.annotate(
                            "comment",
                            span.start.blockIndex,
                            span.start.char,
                            span.end.char,
                            body,
                            span.end.blockIndex,
                          )
                        }
                        onReply={(rootAnnotationId, body) =>
                          void controller.reply(rootAnnotationId, body)
                        }
                        onUpdateAnnotation={(id, body) => controller.updateAnnotation(id, body)}
                        resolveAuthorLabel={resolveAuthorLabel}
                        onExit={() => onExit?.(0)}
                      />
                    )}
                  </box>
                  {threadFooter}
                </box>
              }
              changesOpen={workbench.changesOpen}
              projectOpen={workbench.projectOpen}
              onToggleChanges={workbench.toggleChanges}
              onToggleProject={workbench.toggleProject}
              onToggleRight={workbench.toggleRight}
              projectMode={workbench.projectMode}
              zoomHideThread={workbench.zoomed}
              changesFooter={threadFooter}
              changesPanel={
                <EditorGrid
                  tree={workbench.grid}
                  focusedGroupId={workbench.activeGroup}
                  commentCounts={diffCommentCounts}
                  onFocusGroup={workbench.focusGroup}
                  onActivateTab={workbench.activate}
                  onCloseTab={workbench.close}
                  onSplit={workbench.split}
                  onZoom={workbench.toggleZoom}
                  zoomed={workbench.zoomed}
                  renderTab={(tab, groupFocused) => (
                    <GridTabContent
                      tab={tab}
                      rows={rows}
                      surface={{
                        session: activeSession,
                        quickActions,
                        observer,
                        commentsEnabled: true,
                        resolved,
                        suspended: surfaceSuspended(
                          threadViewSuspended || !groupFocused,
                          focusedPane,
                          "changes",
                        ),
                        onComposingChange: setThreadComposing,
                        onObserverBlocked: (reason) =>
                          controller.setStatus(
                            reason === "observer"
                              ? "observer - read-only"
                              : "review submitted - read-only",
                          ),
                        onCursorChange: setCursor,
                        focusedAnnotationId,
                        onFocusAnnotation: setFocusedAnnotationId,
                        // a diff thread's Changes view is the artifact itself; any other thread's is the
                        // live working-tree diff, so its notes carry a file target and anchor there
                        onAnnotate: (span, body) =>
                          void controller.annotate(
                            "comment",
                            span.start.blockIndex,
                            span.start.char,
                            span.end.char,
                            body,
                            span.end.blockIndex,
                            isDiff
                              ? { kind: "artifact" }
                              : { kind: "file", path: "", rev: "worktree" },
                          ),
                        onReply: (rootAnnotationId, body) =>
                          void controller.reply(rootAnnotationId, body),
                        onUpdateAnnotation: (id, body) => controller.updateAnnotation(id, body),
                        resolveAuthorLabel,
                        leaderCombos,
                        onLeaderCommand: runLeaderCommand,
                        onExit: () => onExit?.(0),
                      }}
                      rejectedRows={rejectedRows}
                      fold={diffFold}
                      fileStats={controller.fileStats()}
                      split={diffView === "split" && workbench.zoomed}
                      dimmed={walking}
                      readFile={(path) => controller.repoReadFile(path)}
                      onAddFileComment={(path, anchor, body) =>
                        void controller.addComment(
                          anchor,
                          { kind: "file", path, rev: "worktree" },
                          body,
                        )
                      }
                      theme={theme}
                    />
                  )}
                  theme={theme}
                />
              }
              projectPanel={
                <ProjectPanelBody
                  mode={workbench.projectMode}
                  loadChanges={() => controller.repoChanges()}
                  loadProjectFiles={() => controller.repoFiles()}
                  reloadKey={activeSession.id}
                  // the Changes navigator always opens a changed file as a diff - a diff review shows its
                  // captured snapshot, every other thread the live working-tree diff
                  onOpenChangedFile={(path) => workbench.openFile(path, "diff")}
                  onOpenProjectFile={(path) => workbench.openFile(path, "contents")}
                  commentCounts={diffCommentCounts}
                  focused={focusedPane === "project"}
                  theme={theme}
                />
              }
              theme={theme}
            >
              <TrailingOverlays
                walking={walking}
                walk={walk}
                walkFileList={walkFileList}
                viewedPaths={viewedPaths}
                session={activeSession}
                terminalWidth={terminalWidth}
                theme={theme}
                mode={mode}
                toast={toast}
                setMode={setMode}
                dispatch={dispatch}
              />
              {submitConfirmState !== null ? (
                <box
                  onMouseUp={submitConfirmState.onCancel}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "100%",
                    height: "100%",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <box onMouseUp={(event) => event.stopPropagation()}>
                    <ConfirmCard {...submitConfirmState} theme={theme} />
                  </box>
                </box>
              ) : null}
              <ManageAccessDialog
                isOpen={accessDialogOpen}
                logins={allowedLogins}
                onAdd={(login) => controller.setShareAccess([...allowedLogins, login])}
                onRemove={(login) =>
                  controller.setShareAccess(allowedLogins.filter((entry) => entry !== login))
                }
                onCreateLink={() => {
                  setAccessDialogOpen(false);
                  controller.share();
                }}
                onClose={() => setAccessDialogOpen(false)}
                theme={theme}
              />
              <ShareChoiceDialog
                isOpen={mode.type === "shareChoice"}
                selectedIndex={shareChoiceIndex(mode)}
                onPublicShare={onShareRequest}
                onPrivateShare={onPrivateShareRequest}
                onClose={() => setMode({ type: "normal" })}
                theme={theme}
              />
              {menuChrome}
            </AppShell>
          </MenuControlProvider>
        </ThemeProvider>
      </PaletteNamesContext.Provider>
    </SlashSkillsContext.Provider>
  );
}
