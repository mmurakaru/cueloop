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
import type { Clock, MouseEvent } from "@opentui/core";
import { displayText, marksByDisplay, spanFromRange, type Mark } from "./view-plan";
import { dimmedTheme } from "./theme";
import {
  DEFAULT_KEYS,
  DEFAULT_QUICK_ACTIONS,
  loadConfig,
  persistAuthorName,
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
import { launchHarnessInSplit } from "@cueloop/daemon/herdr-split";
import { activeSpanState, createIntentDispatch, type Mode } from "./intent-dispatch";
import { reduceKey } from "./keymap";
import { KeyBindings } from "./key-bindings";
import { ThemeProvider } from "./components/theme-context";
import { Button } from "./components/primitives/Button";
import { Toolbar } from "./components/primitives/Toolbar";
import { Breadcrumb } from "./components/Breadcrumb";
import { PlanSheet, type PlanSheetHandle } from "./components/PlanSheet";
import { DiffSheet } from "./components/DiffSheet";
import { PrototypeSheet } from "./components/PrototypeSheet";
import type { PrototypeElement } from "./prototype-browser";
import { type ReviewRailHandle } from "./components/ReviewRail";
import type { AgentTerminalHandle } from "./components/agent-launcher";
import { ReviewPanel } from "./components/ReviewPanel";
import {
  REVIEW_DEFAULT_WIDTH,
  resolveReviewWidth,
  toggleReviewPanelMode,
  widthFromMouseColumn,
  type ReviewPanelMode,
} from "./review-panel";
import {
  buildActiveSpan,
  buildCardEditState,
  buildComposeState,
  buildDiffComposeState,
  buildHeaderItems,
  buildPopoverState,
  buildRenderFlags,
  buildSubmitConfirmState,
  computePendingCount,
  computeRailFootprint,
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
  InboxScreen,
  MenuChrome,
  TrailingOverlays,
} from "./app-screens";

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
  const [mode, setMode] = useState<Mode>({ type: "normal" });
  // the bottom-left menu drop-up and the centered dialog it opens
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDialog, setMenuDialog] = useState<"keybinds" | "settings" | null>(null);
  const [autoClose, setAutoClose] = useState<AutoClose>("off");
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | undefined>(undefined);
  const [selectedCurationId, setSelectedCurationId] = useState<string | undefined>(undefined);
  const [railTab, setRailTab] = useState<"review" | "agent">("review");
  // A running in-tab agent terminal (embedded harness); while set, keys route to it.
  const [agentTerminal, setAgentTerminal] = useState<AgentTerminalHandle | null>(null);
  // review panel layout: mode + expanded width are client view state, loaded
  // from and persisted to the user config so they survive a restart. The ref
  // mirrors the width so the drag-end persist reads the latest value.
  const [reviewMode, setReviewMode] = useState<ReviewPanelMode>("expanded");
  const [reviewWidth, setReviewWidth] = useState(REVIEW_DEFAULT_WIDTH);
  const [dividerDragging, setDividerDragging] = useState(false);
  const reviewWidthRef = useRef(REVIEW_DEFAULT_WIDTH);
  // ~2s focus pulse on the document highlight when a rail card is activated
  const [pulsedAnnotationId, setPulsedAnnotationId] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // live mirror of overlay input text: refs commit synchronously, so the
  // RETURN handler never reads a stale value mid-typing
  const liveInput = useRef("");
  const planSheetRef = useRef<PlanSheetHandle | null>(null);
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
  const rejectedRows = controller.rejectedRows();
  const curationItems = controller.curationItems();
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
  const [prototypeComposing, setPrototypeComposing] = useState(false);
  // sort position per annotation so the rail interleaves annotation and removal
  // cards in one line-ordered stack: a diff row carries its blockIndex; a plan
  // annotation resolves to the display index it marked
  const annotationPositions = useMemo(() => {
    const positions = new Map<string, number>();

    if (!session) return positions;
    if (isDiff) {
      for (const annotation of session.annotations) {
        const blockIndex =
          "blockIndex" in annotation.anchor ? annotation.anchor.blockIndex : undefined;

        if (blockIndex !== undefined) positions.set(annotation.id, blockIndex);
      }
    } else {
      for (const [displayIndex, blockMarks] of marks) {
        for (const mark of blockMarks)
          if (mark.annotationId) positions.set(mark.annotationId, displayIndex);
      }
    }

    return positions;
  }, [session, isDiff, marks]);

  // ── the guided walk's view model ────────────
  const walkFileList = controller.files();
  const walking = isWalking(isDiff, walk);
  const viewedPaths = useMemo(() => new Set(session?.viewedPaths ?? []), [session]);

  // driving needs committed layout, so it runs after render; any transition
  // out of span mode clears the renderer selection (compose paints its own
  // mark, and a mouse drag never changes the mode, so it survives)
  useEffect(() => {
    // one marker at a time: clear any prior selection, then paint the current
    // span (span and its quick-actions sub-mode both keep it painted)
    const span = activeSpanState(mode);

    planSheetRef.current?.clearSelection();
    if (span) planSheetRef.current?.driveSpanSelection(span);
  }, [mode]);

  // ── selection symmetry: one selected id, both sides ──
  const pulse = (id: string): void => {
    setPulsedAnnotationId(id);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulsedAnnotationId(null), 2000);
  };

  /** Card activation scrolls the document to the anchor and pulses it. */
  const revealAnchor = (annotationId: string): void => {
    for (const [displayIndex, blockMarks] of marks) {
      if (!blockMarks.some((mark) => mark.annotationId === annotationId)) continue;
      setCursor(displayIndex);
      planSheetRef.current?.revealBlock(displayIndex);

      return;
    }
  };

  const selectCardFromDocument = (annotationId: string): void => {
    setFocusedAnnotationId(annotationId);
    railRef.current?.revealCard(annotationId);
  };

  const selectCardFromRail = (annotationId: string): void => {
    setFocusedAnnotationId(annotationId);
    pulse(annotationId);
    revealAnchor(annotationId);
  };

  // selecting a removal reveals its source line, so the reader sees what the
  // pending undo would bring back: the diff sheet follows the cursor; the plan
  // sheet also needs an explicit scroll to the cut block
  const selectCurationFromRail = (curationId: string): void => {
    setSelectedCurationId(curationId);
    const item = curationItems.find((candidate) => candidate.id === curationId);

    if (!item) return;
    setCursor(item.revealIndex);
    if (item.source === "plan") planSheetRef.current?.revealBlock(item.revealIndex);
  };

  // the selected removal card's undo button: same restore path as the u key,
  // including the observer read-only guard the keyboard path gets via reduceKey
  const undoCurationFromRail = (curationId: string): void => {
    if (observer) return controller.setStatus("observer - read-only");
    controller.restoreCuration(curationId);
    setSelectedCurationId(undefined);
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
    inbox,
    inboxCursor,
    mode,
    session,
    reviewMode,
    reviewWidth,
    terminalWidth,
    focusedAnnotationId,
    selectedCurationId,
    authorNames,
    quickActions,
    renameAuthor: (id: string, name: string) => {
      persistAuthorName(id, name);
      setAuthorNames((prev) => ({ ...prev, [id]: name }));
    },
    liveInput,
    reviewWidthRef,
    planSheetRef,
    setCursor,
    setInboxCursor,
    setMode,
    setReviewMode,
    setReviewWidth,
    setRailTab,
    setFocusedAnnotationId,
    setSelectedCurationId,
    setPulsedAnnotationId,
    selectCardFromDocument,
    runEditorHandOff,
    openCardEdit,
  });

  const overlay = resolveOverlay(mode, completion.phase, walking);

  useKeyboard((key) => {
    // The prototype compose textarea owns the keyboard while open: let it receive
    // the typed note instead of the global keymap acting on each letter.
    if (prototypeComposing) return;
    // A running in-tab agent terminal owns the keyboard: forward every key to it,
    // with ctrl+] as the detach chord back to the review.
    if (agentTerminal) {
      if (key.ctrl && key.name === "]") return void agentTerminal.detach();

      return void agentTerminal.write(key.sequence);
    }
    if (menuDialog === "settings") return void handleSettingsKey(key.name);
    if (menuDialog) return void (key.name === "escape" && setMenuDialog(null));
    if (menuOpen) return void (key.name === "escape" && setMenuOpen(false));
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

    keyBindings.setContext({ overlay: state.overlay, spanMode: state.spanMode });
    const action = keyBindings.resolveAction({ name: key.name, shift: !!key.shift });

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
      menuOpen={menuOpen}
      menuDialog={menuDialog}
      status={status}
      theme={theme}
      setMenuOpen={setMenuOpen}
      setMenuDialog={setMenuDialog}
      keybindsSections={keyBindings.cheatsheet()}
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
      <InboxScreen
        inbox={inbox}
        inboxCursor={inboxCursor}
        mode={mode}
        theme={theme}
        controller={controller}
        setMode={setMode}
        menuChrome={menuChrome}
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

  const composeState = buildComposeState({ mode, isDiff, display, liveInput, setMode, dispatch });
  const diffComposeState = buildDiffComposeState({
    mode,
    isDiff,
    rows,
    liveInput,
    setMode,
    dispatch,
  });
  const activeSpan = buildActiveSpan(mode, isDiff);
  const popoverState = buildPopoverState({
    mode,
    isDiff,
    quickActions,
    isOwner,
    observer,
    resolved,
    controller,
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
  const cardEditState = buildCardEditState({ mode, liveInput, setMode, dispatch });
  const pendingCount = computePendingCount(activeSession);
  const railFootprint = computeRailFootprint(reviewMode, reviewWidth, terminalWidth);
  const headerItems = buildHeaderItems({ session: activeSession, resolved, observer, role });
  const { showOwnerActions, prototypeCanComment, chromeHidden, prototypePath, railResolvedIds } =
    buildRenderFlags({
      session: activeSession,
      isOwner,
      isDiff,
      isPrototype,
      resolved,
      menuOpen,
      menuDialog,
      resolvedIds,
    });

  // a mouse drag leaves a native selection: turn it into a word span so the
  // marker popover opens at the dragged range, mirroring the `v` grammar.
  // Returns whether a native selection existed (the release ended a drag).
  const activateSpanFromSelection = (preferredIndex?: number): boolean => {
    if (!renderer?.hasSelection) return false;
    // the release block re-anchors the span, so each drag replaces the last
    const selection = planSheetRef.current?.readSelection(preferredIndex);
    const block = selection ? display[selection.displayIndex] : undefined;
    const span =
      selection && block
        ? spanFromRange(selection.displayIndex, displayText(block), selection.start, selection.end)
        : null;

    if (span) setMode({ type: "span", span });

    return true;
  };

  const onLineActivate = (displayIndex: number): void => {
    if (activateSpanFromSelection(displayIndex)) return;
    setCursor(displayIndex);
    const annotationId = marks.get(displayIndex)?.[0]?.annotationId;

    if (annotationId) selectCardFromDocument(annotationId);
  };

  // a drag released outside any block's text (the gutter, past a line end, a
  // gap between blocks) never reaches a block handler; the sheet-level release
  // still turns the finished drag into a span
  const onSelectionRelease = (): void => {
    activateSpanFromSelection();
  };

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

  // the clickable chevron toggles expanded <-> compact; the keybinding (b)
  // cycles all three including hidden
  const onToggleReviewPanel = (): void => {
    const next = toggleReviewPanelMode(reviewMode);

    setReviewMode(next);
    controller.saveReviewPanel({ mode: next });
  };
  // grabbing the divider only arms a drag when there is a width to drag
  const onDividerGrab = (): void => {
    if (reviewMode === "expanded") setDividerDragging(true);
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
        onMouseDrag={(event: MouseEvent) => {
          if (!dividerDragging || reviewMode !== "expanded") return;
          const next = widthFromMouseColumn(event.x, terminalWidth);

          // many raw mouse-moves land in the same column: only re-render when the
          // width actually changes, so the drag does not reconcile per pixel
          if (next === reviewWidthRef.current) return;
          reviewWidthRef.current = next;
          setReviewWidth(next);
        }}
        onMouseUp={() => {
          if (!dividerDragging) return;
          setDividerDragging(false);
          controller.saveReviewPanel({ width: reviewWidthRef.current });
        }}
      >
        <box
          style={{ flexDirection: "row", height: 2, paddingTop: 1, backgroundColor: theme.panel }}
        >
          <box style={{ flexGrow: 1, flexDirection: "row", paddingRight: 1 }}>
            <Breadcrumb items={headerItems} />
            <box style={{ flexGrow: 1 }} />
            {showOwnerActions ? (
              <Toolbar>
                <Button onPress={onEditRequest} theme={theme}>
                  {" Edit "}
                </Button>
                <Button onPress={onShareRequest} theme={theme}>
                  {" Share "}
                </Button>
              </Toolbar>
            ) : null}
          </box>
          <box style={{ width: railFootprint }} />
        </box>
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
            <PlanSheet
              ref={planSheetRef}
              session={activeSession}
              display={display}
              marks={marks}
              cursor={cursor}
              activeSpan={activeSpan}
              compose={composeState}
              popover={popoverState}
              editOrphanCount={editOrphanCount}
              onLineActivate={onLineActivate}
              onSelectionRelease={onSelectionRelease}
            />
          )}
          <ReviewPanel
            mode={reviewMode}
            width={resolveReviewWidth(reviewWidth, terminalWidth)}
            onDividerGrab={onDividerGrab}
            onToggle={onToggleReviewPanel}
            railRef={railRef}
            rail={{
              session: activeSession,
              authorNames,
              selectedId: focusedAnnotationId,
              resolvedIds: railResolvedIds,
              curationItems,
              selectedCurationId,
              annotationPositions,
              railTab,
              pendingCount,
              cardEdit: cardEditState,
              submitConfirm: submitConfirmState,
              onTabChange: setRailTab,
              onSelectCard: selectCardFromRail,
              onActivateCard: openCardEdit,
              onSelectCuration: selectCurationFromRail,
              onUndoCuration: undoCurationFromRail,
              onSubmitRequest,
              onLaunchHarness: (command, seedText) =>
                launchHarnessInSplit({
                  command,
                  cwd: activeSession.artifact.meta.cwd ?? process.cwd(),
                  seedText,
                }),
              onAgentTerminal: setAgentTerminal,
            }}
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
        {menuChrome}
      </box>
    </ThemeProvider>
  );
}
