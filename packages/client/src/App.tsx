/**
 * The cueloop TUI: state wiring, keymap dispatch, and layout composition -
 * nothing else. Rendering lives in components/, daemon IO and the mutation
 * primitives in session-controller.ts, the keyboard grammar in keymap.ts with
 * binding resolution and status hints from key-bindings.ts, and theming in
 * the ThemeProvider. Selection is the entry primitive (mouse drag or keyboard
 * span on one native renderer selection); annotation text lives in the rail
 * while the document keeps only the highlight, and one selected id drives
 * both sides.
 */

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
import { dimmedTheme } from "./theme";
import {
  DEFAULT_KEYS,
  DEFAULT_QUICK_ACTIONS,
  loadConfig,
  persistAuthorName,
  persistPins,
  type AutoClose,
  type QuickAction,
} from "./config";
import {
  composeTheme,
  DEFAULT_THEME_NAME,
  themeForName,
  type Appearance,
  type ThemeName,
} from "./theme-presets";
import type { Theme } from "./theme";
import { createReviewController, type ShareTransport } from "./session-controller";
import type { SessionClient } from "@cueloop/daemon/client";
import { createIntentDispatch, type Mode } from "./intent-dispatch";
import { reduceKey, type KeyState } from "./keymap";
import { KeyBindings, type CheatsheetSection } from "./key-bindings";
import { ThemeProvider } from "./components/theme-context";
import { Button } from "./components/primitives/Button";
import { Toolbar } from "./components/primitives/Toolbar";
import { groupInbox, projectName, threadTitle } from "./components/session-tree";
import { ThreadsSidebar } from "./components/ThreadsSidebar";
import { ChangesColumn, useDiffColumns } from "./components/ChangesColumn";
import { ThreadFooter } from "./components/ThreadFooter";
import { ConfirmCard } from "./components/ConfirmCard";
import { THREAD_VIEW_CHEATSHEET, ThreadView } from "./components/ThreadView";
import {
  RAIL_CHORD_ENTRIES,
  resolveThreadChord,
  THREAD_CHORD_ENTRIES,
  TREE_CHORD_ENTRIES,
} from "./thread-chords";
import { DiffSheet } from "./components/DiffSheet";
import { PrototypeSheet } from "./components/PrototypeSheet";
import type { PrototypeElement } from "./prototype-browser";
import { type RailTab, type ReviewRailHandle } from "./components/ReviewRail";
import { REVIEW_DEFAULT_WIDTH, type ReviewPanelMode } from "./review-panel";
import {
  buildDiffComposeState,
  buildRenderFlags,
  buildSubmitConfirmState,
  computeRoleCapabilities,
  deriveReviewFlags,
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
import { AppHeader } from "./components/AppHeader";

/** A toast clears itself after this idle; esc dismisses it sooner. */
const TOAST_DISMISS_MS = 4000;

export interface AppProps {
  home?: string;
  sessionId?: string;
  /**
   * Observer mode (SSH-served connections): every mutating primitive is ignored and
   * answers "observer - read-only" in the status line; navigation still works.
   */
  readOnly?: boolean;
  onExit?: (code: number) => void;
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
}

/** True while the drop-up or one of its dialogs is open and owns the keyboard. */
function menuChromeOpen(menuDialog: "keybinds" | "settings" | null): boolean {
  return menuDialog !== null;
}

/** True while a menu or an overlay owns the keyboard instead of the thread view. */
function keyboardOwnedElsewhere(menuOwnsKeyboard: boolean, overlay: KeyState["overlay"]): boolean {
  return menuOwnsKeyboard || overlay !== "none";
}

/** The footer submit fires only for the owner of an unresolved review, never an observer. */
function canSubmitReview(isOwner: boolean, resolved: boolean, observer: boolean): boolean {
  return isOwner && !resolved && !observer;
}

/** The keybinds dialog content: the thread grammar while the thread view owns the keys. */
function cheatsheetFor(keyBindings: KeyBindings, threadViewActive: boolean): CheatsheetSection[] {
  const base = keyBindings.cheatsheet();

  if (!threadViewActive) {
    return base;
  }

  return [
    ...THREAD_VIEW_CHEATSHEET,
    { title: "Session", entries: [...THREAD_CHORD_ENTRIES] },
    { title: "Rail", entries: [...RAIL_CHORD_ENTRIES] },
    { title: "Tree", entries: [...TREE_CHORD_ENTRIES] },
    ...base.filter((section) => section.title === "Agent terminal"),
  ];
}

export function App({
  home,
  sessionId,
  readOnly = false,
  onExit,
  clock,
  openClient,
  shareTransport,
  role = "owner",
  selfAuthor,
  appearance = "dark",
}: AppProps): React.ReactNode {
  const { observer, isOwner } = computeRoleCapabilities(readOnly, role);
  const controller = useMemo(
    () =>
      createReviewController({
        home,
        sessionId,
        readOnly: observer,
        onExit,
        clock,
        openClient,
        shareTransport,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, sessionId],
  );

  useEffect(() => {
    controller.connect();

    return () => controller.close();
  }, [controller]);
  // stable across renders so the memoized PrototypeSheet is not re-rendered by
  // unrelated App state (status ticks, a rail-width drag)
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
  const [sidebarOpen, setSidebarOpen] = useState(sessionId === undefined);
  const [mode, setMode] = useState<Mode>({ type: "normal" });
  // the top-left settings gear drop-down and the centered dialog it opens
  const [menuDialog, setMenuDialog] = useState<"keybinds" | "settings" | null>(null);
  const [autoClose, setAutoClose] = useState<AutoClose>("off");
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | undefined>(undefined);
  const [selectedCurationId, setSelectedCurationId] = useState<string | undefined>(undefined);
  const [railTab, setRailTab] = useState<RailTab>("review");
  // the tree row the reviewer stands on in the rail's Tree tab
  const [selectedEntryId, setSelectedEntryId] = useState<string | undefined>(undefined);
  // review panel layout: mode + expanded width are client view state, loaded
  // from and persisted to the user config so they survive a restart. The ref
  // mirrors the width so the drag-end persist reads the latest value.
  const [reviewMode, setReviewMode] = useState<ReviewPanelMode>("expanded");
  const [reviewWidth, setReviewWidth] = useState(REVIEW_DEFAULT_WIDTH);
  const reviewWidthRef = useRef(REVIEW_DEFAULT_WIDTH);
  // ~2s focus pulse on the document highlight when a rail card is activated
  const [pulsedAnnotationId, setPulsedAnnotationId] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // live mirror of overlay input text: refs commit synchronously, so the
  // RETURN handler never reads a stale value mid-typing
  const liveInput = useRef("");
  const railRef = useRef<ReviewRailHandle | null>(null);
  // keymap from layered config; the loaded theme swaps the provider value
  const keysRef = useRef(DEFAULT_KEYS);
  const keyBindings = useMemo(() => new KeyBindings(DEFAULT_KEYS), []);
  const [theme, setTheme] = useState(() => themeForName(DEFAULT_THEME_NAME, appearance));
  const [themeName, setThemeName] = useState<ThemeName>(DEFAULT_THEME_NAME);
  const [themeOverrides, setThemeOverrides] = useState<Partial<Theme>>({});
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const [quickActions, setQuickActions] = useState<QuickAction[]>(DEFAULT_QUICK_ACTIONS);

  useEffect(() => {
    const config = loadConfig({ repoRoot: session?.workspace.repoRoot });

    keysRef.current = config.keys;
    keyBindings.setKeys(config.keys);
    setTheme(composeTheme(config.ui.theme, config.themeOverrides, appearance));
    setThemeName(config.ui.theme);
    setThemeOverrides(config.themeOverrides);
    setReviewMode(config.ui.reviewState);
    setReviewWidth(config.ui.reviewWidth);
    reviewWidthRef.current = config.ui.reviewWidth;
    setAuthorNames(config.authors);
    setQuickActions(config.actions);
    setAutoClose(config.ui.autoClose);
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
    reviewMode,
    setReviewMode,
    themeName,
    setThemeName,
    themeOverrides,
    setTheme,
    quickActions,
    setQuickActions,
    controller,
    setMenuDialog,
  });

  // ── derived view model ──────────────────────
  const display = controller.display();
  const rows = controller.rows();
  const diffColumns = useDiffColumns({ session, rows, cursor, setCursor });
  const rejectedRows = controller.rejectedRows();
  const marks = useMemo(
    () =>
      session
        ? marksByDisplay(session.annotations, display, pulsedAnnotationId ?? undefined)
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
  // plans and replies open in the thread view; diffs and prototypes keep their sheets
  const threadViewActive = session !== null && !isDiff && !isPrototype;
  const [threadComposing, setThreadComposing] = useState(false);
  const [prototypeComposing, setPrototypeComposing] = useState(false);
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
    railRef.current?.revealCard(annotationId);
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
    reviewMode,
    reviewWidth,
    terminalWidth,
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
    liveInput,
    reviewWidthRef,
    setCursor,
    setInboxCursor,
    setMode,
    setReviewMode,
    setReviewWidth,
    setRailTab,
    setSelectedEntryId,
    setFocusedAnnotationId,
    setSelectedCurationId,
    setPulsedAnnotationId,
    selectCardFromDocument,
    runEditorHandOff,
    openCardEdit,
  });

  const overlay = resolveOverlay(mode, completion.phase, walking);

  const menuOwnsKeyboard = menuChromeOpen(menuDialog);
  // an overlay (submit, walk, prompt, confirm) or the menu takes the keyboard
  // from the thread view; the view suspends its own grammar meanwhile
  const threadViewSuspended = keyboardOwnedElsewhere(menuOwnsKeyboard, overlay);

  useKeyboard((key) => {
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
      });

      if (chord) dispatch(chord);

      return;
    }
    // The prototype compose textarea owns the keyboard while open: let it receive
    // the typed note instead of the global keymap acting on each letter.
    if (prototypeComposing) return;
    if (menuDialog === "settings") return void handleSettingsKey(key.name);
    if (menuDialog) return void (key.name === "escape" && setMenuDialog(null));
    // the toast is non-modal: escape only dismisses it when nothing else owns
    // escape, so an open overlay (compose, submit, prompt, walk) still cancels
    if (toast && key.name === "escape" && overlay === "none" && mode.type !== "span")
      return controller.dismissToast();
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

  // ── shared bottom chrome: the menu bar and its drop-up dialogs, one render
  // reused by the inbox and by plan/diff review so the two never drift ──
  const menuChrome = (
    <MenuChrome
      menuDialog={menuDialog}
      theme={theme}
      keybindsSections={cheatsheetFor(keyBindings, threadViewActive)}
      settingsCategories={settingsCategories}
      settingsValues={settingsValues}
      settingsNav={settingsNav}
      onCategorySelect={onCategorySelect}
      cycleSetting={cycleSetting}
    />
  );

  // ── render ──────────────────────────────────
  if (error) return <ErrorScreen error={error} theme={theme} />;
  if (!session)
    return inbox ? (
      <NoThreadShell
        rows={grouped.rows}
        inboxCursor={inboxCursor}
        mode={mode}
        theme={theme}
        controller={controller}
        setMode={setMode}
        menuChrome={menuChrome}
        onOpenMenu={() => setMenuDialog("settings")}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        pinnedIds={pinnedIds}
        onPin={togglePin}
        onRename={(id, title) => setMode({ type: "renameThread", sessionId: id, text: title })}
      />
    ) : (
      <ConnectingScreen theme={theme} />
    );

  const activeSession = session;

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

  const diffComposeState = buildDiffComposeState({
    mode,
    isDiff,
    rows,
    liveInput,
    setMode,
    dispatch,
  });
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
    isPrototype,
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

  // clicking the header Share button: publish the plan, copy the ssh line
  const onShareRequest = (): void => {
    if (!isOwner) return controller.setStatus("only the plan owner can share");
    controller.share();
  };

  // clicking the rail Submit button: same read-only answer as the submit key
  const onSubmitRequest = (): void => {
    if (observer) return controller.setStatus("observer - read-only");
    if (!isOwner) return controller.setStatus("shared view - your notes save as you go");
    if (resolved) return;
    dispatch({ type: "openSubmit" });
  };

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
        <AppHeader
          onOpenMenu={() => setMenuDialog("settings")}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          title={threadTitle(activeSession)}
          editShare={
            showOwnerActions ? (
              <Toolbar>
                <Button onPress={onEditRequest} theme={theme}>
                  {" Edit "}
                </Button>
                <Button onPress={onShareRequest} theme={theme}>
                  {" Share "}
                </Button>
              </Toolbar>
            ) : null
          }
          changesOpen={diffColumns.changesOpen}
          onToggleChanges={diffColumns.toggleChanges}
          theme={theme}
        />
        <box style={{ flexGrow: 1, flexDirection: "row" }}>
          <ThreadsSidebar
            open={sidebarOpen}
            rows={grouped.rows}
            cursor={inboxCursor}
            activeId={session.id}
            pinnedIds={pinnedIds}
            onSelect={(id) => controller.open(id)}
            onPin={togglePin}
            onRename={(id, title) => setMode({ type: "renameThread", sessionId: id, text: title })}
            theme={theme}
          />
          <box style={{ flexGrow: 1, flexDirection: "column" }}>
            <box style={{ flexGrow: 1, flexDirection: "row" }}>
              {isPrototype ? (
                <PrototypeSheet
                  prototypePath={prototypePath}
                  quickActions={quickActions}
                  canComment={prototypeCanComment}
                  onCommentElement={onCommentPrototype}
                  onComposingChange={setPrototypeComposing}
                  hidden={chromeHidden}
                />
              ) : isDiff ? (
                // the sheet dims to reading-quiet colors while the wizard has focus
                <DiffSheet
                  rows={rows}
                  cursor={cursor}
                  annotations={activeSession.annotations}
                  focusedAnnotationId={focusedAnnotationId}
                  rejectedRows={rejectedRows}
                  compose={diffComposeState}
                  theme={walking ? dimmedTheme(theme) : undefined}
                />
              ) : (
                <ThreadView
                  session={activeSession}
                  suspended={threadViewSuspended}
                  editOrphanCount={editOrphanCount}
                  onComposingChange={setThreadComposing}
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
                  onExit={() => onExit?.(0)}
                />
              )}
            </box>
            <ThreadFooter
              repo={projectName(activeSession.workspace)}
              branch={activeSession.workspace.branch}
              onSubmit={onSubmitRequest}
              canSubmit={canSubmitReview(isOwner, resolved, observer)}
              theme={theme}
            />
          </box>
          <ChangesColumn
            open={diffColumns.changesOpen}
            files={activeSession.artifact.files}
            selectedPath={diffColumns.currentFilePath}
            onSelectFile={diffColumns.scrollToFile}
            theme={theme}
          />
        </box>
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
            <ConfirmCard {...submitConfirmState} theme={theme} />
          </box>
        ) : null}
        {menuChrome}
      </box>
    </ThemeProvider>
  );
}
