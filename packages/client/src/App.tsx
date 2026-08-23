/**
 * The cueloop TUI: state wiring, keymap dispatch, and layout composition -
 * nothing else. Rendering lives in components/, daemon IO and the mutation
 * verbs in session-controller.ts, the keyboard grammar in keymap.ts with
 * binding resolution and status hints from key-bindings.ts, and theming in
 * the ThemeProvider. Selection is the entry primitive (mouse drag or keyboard
 * span on one native renderer selection); annotation text lives in the rail
 * while the document keeps only the highlight, and one selected id drives
 * both sides.
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { Clock, MouseEvent } from "@opentui/core";
import { type VerdictKind } from "@cueloop/schema";
import { displayText, marksByDisplay, spanFromRange, type Mark } from "./view-plan";
import { noteForFile, viewedCount } from "./walk";
import { DARK, dimmedTheme } from "./theme";
import {
  DEFAULT_KEYS,
  DEFAULT_QUICK_ACTIONS,
  loadConfig,
  persistActions,
  persistAuthorName,
  persistAutoClose,
  persistTheme,
  type AutoClose,
  type QuickAction,
} from "./config";
import {
  composeTheme,
  DEFAULT_THEME_NAME,
  THEME_LABELS,
  THEME_NAMES,
  type ThemeName,
} from "./theme-presets";
import type { Theme } from "./theme";
import { returnPaneFor } from "@cueloop/schema";
import { createReviewController } from "./session-controller";
import type { SessionClient } from "@cueloop/daemon/client";
import { launchHarnessInSplit } from "@cueloop/daemon/herdr-split";
import {
  activeSpanState,
  createIntentDispatch,
  reviewerAnnotations,
  type Mode,
} from "./intent-dispatch";
import { reduceKey, type KeyState } from "./keymap";
import { KeyBindings } from "./key-bindings";
import { ThemeProvider } from "./components/theme-context";
import { Button } from "./components/primitives/Button";
import { Toolbar } from "./components/primitives/Toolbar";
import { MenuBar } from "./components/MenuBar";
import { KeybindsDialog } from "./components/KeybindsDialog";
import { SettingsDialog, type SettingsCategory } from "./components/SettingsDialog";
import { QuickActionsEditor } from "./components/quick-actions-editor";
import { CLIENT_VERSION } from "./version";
import { Breadcrumb, type BreadcrumbItem } from "./components/Breadcrumb";
import { PlanSheet, type PlanSheetHandle } from "./components/PlanSheet";
import { DiffSheet } from "./components/DiffSheet";
import { type ReviewRailHandle } from "./components/ReviewRail";
import type { AgentTerminalHandle } from "./components/agent-launcher";
import { ReviewPanel } from "./components/ReviewPanel";
import {
  REVIEW_COMPACT_WIDTH,
  REVIEW_DEFAULT_WIDTH,
  resolveReviewWidth,
  toggleReviewPanelMode,
  widthFromMouseColumn,
  type ReviewPanelMode,
} from "./review-panel";
import { CompletionOverlay } from "./components/CompletionOverlay";
import { InboxList } from "./components/InboxList";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { PromptDialog } from "./components/PromptDialog";
import { WalkWizard } from "./components/WalkWizard";
import { Toast } from "./components/Toast";

/** A toast clears itself after this idle; esc dismisses it sooner. */
const TOAST_DISMISS_MS = 4000;

export interface AppProps {
  home?: string;
  sessionId?: string;
  /**
   * Observer mode (SSH-served connections): every mutating verb is ignored and
   * answers "observer - read-only" in the status line; navigation still works.
   */
  readOnly?: boolean;
  onExit?: (code: number) => void;
  /** Timer source for the auto-close countdown; tests inject a ManualClock. */
  clock?: Clock;
  /** Session source; the sharing gateway injects a blob-backed client. */
  openClient?: () => Promise<SessionClient>;
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
}

export function App({
  home,
  sessionId,
  readOnly = false,
  onExit,
  clock,
  openClient,
  role = "owner",
  selfAuthor,
}: AppProps): React.ReactNode {
  // Observer stays fully read-only; a collaborator writes annotations but not
  // the plan or a verdict. `observer` is what the controller and every write
  // gate key off; the two capability flags carve out the collaborator's middle.
  const observer = readOnly || role === "observer";
  // Editing the plan, submitting a verdict, and sharing are all the owner's
  // alone - a collaborator annotates, an observer only reads. One predicate
  // feeds all three; split it the day a collaborator earns one of them.
  const isOwner = !observer && role === "owner";
  const controller = useMemo(
    () =>
      createReviewController({ home, sessionId, readOnly: observer, onExit, clock, openClient }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, sessionId],
  );
  useEffect(() => {
    controller.connect();
    return () => controller.close();
  }, [controller]);
  const { session, inbox, status, toast, error, completion, editOrphanCount, walk } =
    useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // A shared plan you own polls for collaborator notes while it is open; the
  // merge refreshes through the normal event path. Stops on leave.
  useEffect(() => {
    if (!isOwner || !session?.shareId) return;
    return controller.startSharePoll();
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
  const [settingsNav, setSettingsNav] = useState<{
    categoryId: string;
    rowIndex: number;
    zone: "nav" | "body";
  }>({
    categoryId: "general",
    rowIndex: 0,
    zone: "body",
  });
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
  const [theme, setTheme] = useState(DARK);
  const [themeName, setThemeName] = useState<ThemeName>(DEFAULT_THEME_NAME);
  const [themeOverrides, setThemeOverrides] = useState<Partial<Theme>>({});
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});
  const [quickActions, setQuickActions] = useState<QuickAction[]>(DEFAULT_QUICK_ACTIONS);
  // the quick-action row whose system-prompt input is open in Settings, or null
  const [actionsExpandedIndex, setActionsExpandedIndex] = useState<number | null>(null);
  useEffect(() => {
    const config = loadConfig({ repoRoot: session?.workspace.repoRoot });
    keysRef.current = config.keys;
    keyBindings.setKeys(config.keys);
    setTheme(config.theme);
    setThemeName(config.ui.theme);
    setThemeOverrides(config.themeOverrides);
    setReviewMode(config.ui.reviewState);
    setReviewWidth(config.ui.reviewWidth);
    reviewWidthRef.current = config.ui.reviewWidth;
    setAuthorNames(config.authors);
    setQuickActions(config.actions);
    setAutoClose(config.ui.autoClose);
    controller.applyConfig(config);
  }, [session?.workspace.repoRoot, controller, keyBindings]);
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
  const resolved = session?.status === "resolved";
  const isDiff = session?.artifact.type === "diff";
  // sort position per annotation so the rail interleaves annotation and removal
  // cards in one line-ordered stack: a diff row carries its blockIndex; a plan
  // annotation resolves to the display index it marked
  const annotationPositions = useMemo(() => {
    const positions = new Map<string, number>();
    if (!session) return positions;
    if (isDiff) {
      for (const annotation of session.annotations) {
        const blockIndex = (annotation.anchor as { blockIndex?: number }).blockIndex;
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
  const walking = isDiff && walk !== null;
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

  const overlay: KeyState["overlay"] =
    mode.type === "compose" || mode.type === "railEdit"
      ? "compose"
      : mode.type === "submit"
        ? "submit"
        : mode.type === "confirmDelete"
          ? "confirm"
          : mode.type === "rename" || mode.type === "nameSelf"
            ? "prompt"
            : mode.type === "spanActions"
              ? "spanActions"
              : completion.phase === "prompt"
                ? "completion-prompt"
                : completion.phase === "counting"
                  ? "completion-counting"
                  : walking
                    ? "walk"
                    : "none";

  // ── settings dialog: config-backed model, navigation, persistence ──
  const commitActions = (next: QuickAction[]): void => {
    setQuickActions(next);
    persistActions(next);
  };
  const editActionMetadata = (index: number, metadata: string): void =>
    commitActions(
      quickActions.map((action, actionIndex) =>
        actionIndex === index
          ? { ...action, metadata: metadata.trim() ? metadata : undefined }
          : action,
      ),
    );
  const resetActions = (): void => {
    setActionsExpandedIndex(null);
    commitActions(DEFAULT_QUICK_ACTIONS.map((action) => ({ ...action })));
  };
  const addAction = (): void => {
    setSettingsNav((state) => ({ ...state, zone: "body", rowIndex: quickActions.length }));
    commitActions([...quickActions, { prompt: "New action" }]);
  };
  const settingsCategories: SettingsCategory[] = [
    {
      id: "general",
      name: "General",
      description: "submission behaviour",
      rows: [
        {
          key: "autoClose",
          label: "Auto-close on submit",
          kind: "cycle",
          options: ["off", "3s", "10s"],
        },
      ],
    },
    {
      id: "display",
      name: "Display",
      description: "the review panel",
      rows: [
        {
          key: "reviewPanel",
          label: "Review panel",
          kind: "cycle",
          options: ["expanded", "compact", "hidden"],
        },
      ],
    },
    {
      id: "appearance",
      name: "Appearance",
      description: "the color theme",
      rows: [
        {
          key: "theme",
          label: "Theme",
          kind: "cycle",
          options: THEME_NAMES.map((name) => THEME_LABELS[name]),
        },
      ],
    },
    {
      id: "actions",
      name: "Actions",
      description: "quick-action comments",
      rows: [],
      customBody: (
        <QuickActionsEditor
          actions={quickActions}
          selectedIndex={settingsNav.categoryId === "actions" ? settingsNav.rowIndex : -1}
          expandedIndex={actionsExpandedIndex}
          onToggleExpand={(index) => {
            setSettingsNav((state) => ({ ...state, zone: "body", rowIndex: index }));
            setActionsExpandedIndex((current) => (current === index ? null : index));
          }}
          onEditMetadata={editActionMetadata}
          onReset={resetActions}
          onAdd={addAction}
          theme={theme}
        />
      ),
    },
  ];
  const settingsValues = {
    autoClose: autoClose === "off" ? "off" : `${autoClose}s`,
    reviewPanel: reviewMode,
    theme: THEME_LABELS[themeName],
  };
  const cycleSetting = (rowKey: string): void => {
    if (rowKey === "autoClose") {
      const next: AutoClose = autoClose === "off" ? 3 : autoClose === 3 ? 10 : "off";
      setAutoClose(next);
      persistAutoClose(next);
    } else if (rowKey === "reviewPanel") {
      const order: ReviewPanelMode[] = ["expanded", "compact", "hidden"];
      const next = order[(order.indexOf(reviewMode) + 1) % order.length]!;
      setReviewMode(next);
      controller.saveReviewPanel({ mode: next });
    } else if (rowKey === "theme") {
      const next = THEME_NAMES[(THEME_NAMES.indexOf(themeName) + 1) % THEME_NAMES.length]!;
      setThemeName(next);
      setTheme(composeTheme(next, themeOverrides));
      persistTheme(next);
    }
  };
  const handleSettingsKey = (name: string): void => {
    // an open system-prompt input owns typing; only esc (close it) escapes here
    if (actionsExpandedIndex !== null) {
      if (name === "escape") setActionsExpandedIndex(null);
      return;
    }
    if (name === "escape") return void setMenuDialog(null);
    const categoryIndex = settingsCategories.findIndex(
      (category) => category.id === settingsNav.categoryId,
    );
    const category = settingsCategories[categoryIndex]!;
    if (settingsNav.zone === "nav") {
      if (name === "j" || name === "down")
        setSettingsNav({
          categoryId:
            settingsCategories[Math.min(settingsCategories.length - 1, categoryIndex + 1)]!.id,
          rowIndex: 0,
          zone: "nav",
        });
      else if (name === "k" || name === "up")
        setSettingsNav({
          categoryId: settingsCategories[Math.max(0, categoryIndex - 1)]!.id,
          rowIndex: 0,
          zone: "nav",
        });
      else if (name === "l" || name === "tab" || name === "return")
        setSettingsNav((state) => ({ ...state, zone: "body", rowIndex: 0 }));
      return;
    }
    // the Actions category is a list of quick actions plus a trailing "add" row
    if (category.id === "actions") {
      const rowCount = quickActions.length + 1;
      if (name === "j" || name === "down")
        setSettingsNav((state) => ({
          ...state,
          rowIndex: Math.min(rowCount - 1, state.rowIndex + 1),
        }));
      else if (name === "k" || name === "up")
        setSettingsNav((state) => ({ ...state, rowIndex: Math.max(0, state.rowIndex - 1) }));
      else if (name === "h" || name === "tab")
        setSettingsNav((state) => ({ ...state, zone: "nav" }));
      else if (name === "return" || name === "space" || name === "l") {
        if (settingsNav.rowIndex === quickActions.length) addAction();
        else setActionsExpandedIndex(settingsNav.rowIndex);
      }
      return;
    }
    if (name === "j" || name === "down")
      setSettingsNav((state) => ({
        ...state,
        rowIndex: Math.min(category.rows.length - 1, state.rowIndex + 1),
      }));
    else if (name === "k" || name === "up")
      setSettingsNav((state) => ({ ...state, rowIndex: Math.max(0, state.rowIndex - 1) }));
    else if (name === "h" || name === "tab") setSettingsNav((state) => ({ ...state, zone: "nav" }));
    else if (name === "return" || name === "space")
      cycleSetting(category.rows[settingsNav.rowIndex]!.key);
  };

  useKeyboard((key) => {
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
    const state: KeyState = {
      keys: keysRef.current,
      readOnly: observer,
      canEditPlan: isOwner,
      canSubmitVerdict: isOwner,
      canShare: isOwner,
      overlay,
      view: !session ? "inbox" : isDiff ? "diff" : "plan",
      spanMode: mode.type === "span",
      resolved: !!resolved,
      hasInboxItems: !!inbox?.length,
      annotationCount: session?.annotations.length ?? 0,
      hasFocusedAnnotation: focusedAnnotationId !== undefined,
      walkAtEnd: walk !== null && walk.index >= walkFileList.length,
      cursorAnnotatable: isDiff
        ? rows[cursor] !== undefined &&
          rows[cursor]!.kind !== "file" &&
          rows[cursor]!.kind !== "hunk"
        : !!display[cursor]?.work,
    };
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
        <KeybindsDialog sections={keyBindings.cheatsheet()} theme={theme} />
      ) : null}
      {menuDialog === "settings" ? (
        <SettingsDialog
          isOpen
          categories={settingsCategories}
          values={settingsValues}
          activeCategoryId={settingsNav.categoryId}
          activeRowIndex={settingsNav.rowIndex}
          activeZone={settingsNav.zone}
          onCategorySelect={(id) => {
            setActionsExpandedIndex(null);
            setSettingsNav({ categoryId: id, rowIndex: 0, zone: "body" });
          }}
          onRowActivate={(row) => cycleSetting(row.key)}
          theme={theme}
        />
      ) : null}
    </>
  );

  // ── render ──────────────────────────────────
  if (error) {
    return (
      <ThemeProvider theme={theme}>
        <text fg={theme.red}>cueloop: {error}</text>
      </ThemeProvider>
    );
  }
  if (!session && !inbox) {
    return (
      <ThemeProvider theme={theme}>
        <text fg={theme.textDim}>connecting to the daemon…</text>
      </ThemeProvider>
    );
  }
  if (!session && inbox) {
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
            onRequestDelete={(id, title) =>
              setMode({ type: "confirmDelete", sessionId: id, title })
            }
          />
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
        </box>
      </ThemeProvider>
    );
  }

  const activeSession = session!;
  const pendingCount =
    reviewerAnnotations(activeSession).length + (activeSession.workingCopy !== undefined ? 1 : 0);

  if ((completion.phase === "prompt" || completion.phase === "counting") && activeSession.verdict) {
    return (
      <ThemeProvider theme={theme}>
        <CompletionOverlay
          verdict={activeSession.verdict.kind}
          completion={completion}
          status={status}
          returnsTo={
            returnPaneFor(activeSession.artifact.meta.herdrPane)
              ? (activeSession.artifact.meta.agent ?? "the agent")
              : undefined
          }
        />
      </ThemeProvider>
    );
  }

  const composeState =
    mode.type === "compose" && !isDiff
      ? {
          kind: mode.kind,
          displayIndex: mode.displayIndex,
          quote: displayText(display[mode.displayIndex]!).slice(mode.start, mode.end),
          draft: {
            text: mode.text,
            onInput: (text: string) => {
              liveInput.current = text;
              setMode({ ...mode, text });
            },
            onSave: () => dispatch({ type: "saveCompose" }),
            onCancel: () => dispatch({ type: "closeOverlay" }),
          },
        }
      : null;

  const diffComposeState =
    mode.type === "compose" && isDiff
      ? {
          kind: mode.kind,
          rowIndex: mode.displayIndex,
          quote: rows[mode.displayIndex]?.text.replace(/\n$/, "") ?? "",
          draft: {
            text: mode.text,
            onInput: (text: string) => {
              liveInput.current = text;
              setMode({ ...mode, text });
            },
            onSave: () => dispatch({ type: "saveCompose" }),
            onCancel: () => dispatch({ type: "closeOverlay" }),
          },
        }
      : null;

  const markedSpan = activeSpanState(mode);
  const activeSpan = markedSpan
    ? { displayIndex: markedSpan.displayIndex, start: markedSpan.start, end: markedSpan.end }
    : mode.type === "compose" && !isDiff
      ? // the compose anchor stays painted selection-style while the box is open
        { displayIndex: mode.displayIndex, start: mode.start, end: mode.end }
      : null;

  // mouse mutations bypass reduceKey, so they replay its gates: an observer or a
  // resolved review is read-only. Returns the status to answer with, or null.
  const spanMutationBlock = (): string | null =>
    observer ? "observer - read-only" : resolved ? "review submitted - read-only" : null;

  // the marker-actions popover is span mode made visible: an inline toolbar at
  // the marked block, or its quick-actions list. Cut is owner-only (hidden for a
  // collaborator, like every other plan-edit affordance).
  const popoverState =
    markedSpan && !isDiff
      ? {
          displayIndex: markedSpan.displayIndex,
          view: mode.type === "spanActions" ? ("actions" as const) : ("toolbar" as const),
          actions: quickActions,
          actionIndex: mode.type === "spanActions" ? mode.index : 0,
          canCut: isOwner,
          onComment: () => {
            const blocked = spanMutationBlock();
            if (blocked) return controller.setStatus(blocked);
            dispatch({ type: "openCompose", kind: "comment", from: "span" });
          },
          onCut: () => {
            const blocked = spanMutationBlock();
            if (blocked) return controller.setStatus(blocked);
            if (!isOwner) return;
            dispatch({ type: "spanCut" });
          },
          onOpenActions: () => {
            const blocked = spanMutationBlock();
            if (blocked) return controller.setStatus(blocked);
            dispatch({ type: "openSpanActions" });
          },
          onClose: () => dispatch({ type: "closeOverlay" }),
          onPickAction: (index: number) => {
            const blocked = spanMutationBlock();
            if (blocked) return controller.setStatus(blocked);
            dispatch({ type: "pickSpanAction", index });
          },
          onBack: () => dispatch({ type: "closeSpanActions" }),
        }
      : null;

  const onLineActivate = (displayIndex: number): void => {
    // a mouse drag leaves a native selection: turn it into a word span so the
    // marker popover opens at the dragged range, mirroring the `v` grammar
    if (renderer?.hasSelection) {
      // the release block re-anchors the span, so each drag replaces the last
      const selection = planSheetRef.current?.readSelection(displayIndex);
      const block = selection ? display[selection.displayIndex] : undefined;
      const span =
        selection && block
          ? spanFromRange(
              selection.displayIndex,
              displayText(block),
              selection.start,
              selection.end,
            )
          : null;
      if (span) setMode({ type: "span", span });
      return;
    }
    setCursor(displayIndex);
    const annotationId = marks.get(displayIndex)?.[0]?.annotationId;
    if (annotationId) selectCardFromDocument(annotationId);
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

  const submitConfirmState =
    mode.type === "submit"
      ? {
          verdict: mode.verdict,
          summary: mode.summary,
          // walk coverage keeps partial passes honest at the verdict
          viewedSummary:
            isDiff && activeSession.viewedPaths !== undefined
              ? `${viewedCount(walkFileList, viewedPaths)}/${walkFileList.length} files viewed`
              : undefined,
          onInput: (summary: string) => {
            liveInput.current = summary;
            setMode({ ...mode, summary });
          },
          onSelectVerdict: (verdict: VerdictKind) => setMode({ ...mode, verdict }),
          onSubmit: () => dispatch({ type: "submitVerdict" }),
          onCancel: () => dispatch({ type: "closeOverlay" }),
        }
      : null;

  const cardEditState =
    mode.type === "railEdit"
      ? {
          id: mode.id,
          text: mode.text,
          onInput: (text: string) => {
            liveInput.current = text;
            setMode({ type: "railEdit", id: mode.id, text });
          },
          onSave: () => dispatch({ type: "saveCompose" }),
          onCancel: () => dispatch({ type: "closeOverlay" }),
        }
      : null;

  // width the review panel occupies (divider + rail), so the header can reserve
  // it and keep Edit/Share pinned to the plan sheet's right edge, not the rail's
  const railFootprint =
    reviewMode === "hidden"
      ? 0
      : 1 +
        (reviewMode === "compact"
          ? REVIEW_COMPACT_WIDTH
          : resolveReviewWidth(reviewWidth, terminalWidth));

  // status badges sit right after the product word so they survive a header
  // that is too narrow for the whole trail (the rail can eat the width)
  const headerItems: BreadcrumbItem[] = [
    { label: "cueloop", tone: "accent" },
    ...(resolved
      ? [
          {
            label: `resolved: ${activeSession.verdict!.kind.replace("_", " ")}`,
            tone: "green" as const,
          },
        ]
      : []),
    ...(observer ? [{ label: "observer", tone: "dim" as const }] : []),
    ...(role === "collaborator"
      ? [{ label: "shared · your notes save as you go", tone: "dim" as const }]
      : []),
    {
      label: `${activeSession.artifact.meta.title ?? activeSession.artifact.meta.planPath ?? activeSession.id} · rev ${activeSession.revisions.length}`,
      tone: "dim",
    },
    { label: `submitted by ${activeSession.artifact.meta.agent ?? "unknown"}`, tone: "dim" },
  ];

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
            {isOwner && !isDiff && !resolved ? (
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
          {isDiff ? (
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
              resolvedIds: isDiff ? null : resolvedIds,
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
        {walking && walk !== null ? (
          <WalkWizard
            files={walkFileList}
            index={walk.index}
            viewedPaths={viewedPaths}
            note={
              walkFileList[walk.index] !== undefined
                ? noteForFile(activeSession.annotations, walkFileList[walk.index]!.path)
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
        {toast ? <Toast title={toast.title} body={toast.body} theme={theme} /> : null}
        {menuChrome}
      </box>
    </ThemeProvider>
  );
}
