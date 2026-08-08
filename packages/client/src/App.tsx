/**
 * The cueloop TUI (#22): Ledger IA reduced to its terminal shape - header,
 * center artifact pane (projection renderer), right review rail, footer hint
 * bar. Thin renderer over the review-session controller: daemon IO and the
 * mutation verbs live in session-controller.ts, the keyboard grammar in
 * keymap.ts; local state is view state only (cursor, span, overlays).
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard } from "@opentui/react";
import { type Annotation, type ReviewSession, type VerdictKind } from "@cueloop/schema";
import {
  blockRuns,
  displayText,
  marksByDisplay,
  overlayMarks,
  spanKey,
  startSpan,
  wrapRuns,
  type DisplayBlock,
  type SpanState,
  type StyleRun,
} from "./view";
import { type DiffRow } from "./view-diff";
import { DARK as T } from "./theme";
import { highlightCode, type CodeToken } from "./syntax";
import { DEFAULT_KEYS, loadConfig } from "./config";
import { returnPaneFor } from "./herdr";
import { createReviewController } from "./session-controller";
import { reduceKey, type Intent, type KeyState } from "./keymap";

export interface AppProps {
  home?: string;
  sessionId?: string;
  /**
   * Observer mode (SSH-served connections): every mutating verb is ignored and
   * answers "observer - read-only" in the status line; navigation still works.
   */
  readOnly?: boolean;
  onExit?: (code: number) => void;
}

type Mode =
  | { m: "normal" }
  | { m: "span"; span: SpanState }
  | { m: "compose"; kind: "comment" | "suggestion"; dispIdx: number; start: number; end: number; text: string }
  | { m: "submit"; verdict: VerdictKind; summary: string };

const VERDICTS: VerdictKind[] = ["comment", "approve", "request_changes"];
const VERDICT_LABEL: Record<VerdictKind, string> = {
  comment: "Comment",
  approve: "Approve",
  request_changes: "Request changes",
};

export function App({ home, sessionId, readOnly = false, onExit }: AppProps): React.ReactNode {
  const controller = useMemo(
    () => createReviewController({ home, sessionId, readOnly, onExit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, sessionId],
  );
  useEffect(() => {
    controller.connect();
    return () => controller.close();
  }, [controller]);
  const { session, inbox, status, error, completion } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  // ── view state ──────────────────────────────
  const [cursor, setCursor] = useState(0);
  const [inboxCursor, setInboxCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ m: "normal" });
  const [focusedAnn, setFocusedAnn] = useState<string | undefined>(undefined);
  // live mirror of overlay input text: refs commit synchronously, so the
  // RETURN handler never reads a stale value mid-typing
  const liveInput = useRef("");
  // keymap from layered config; theme overrides land on the shared tokens
  const keysRef = useRef(DEFAULT_KEYS);
  useEffect(() => {
    const cfg = loadConfig({ repoRoot: session?.workspace.repoRoot });
    keysRef.current = cfg.keys;
    Object.assign(T, cfg.theme);
    controller.applyConfig(cfg);
  }, [session?.workspace.repoRoot, controller]);

  // ── derived view model ──────────────────────
  const display = controller.display();
  const rows = controller.rows();
  const marks = useMemo(
    () => (session ? marksByDisplay(session.annotations, display, focusedAnn) : new Map()),
    [session, display, focusedAnn],
  );
  const resolved = session?.status === "resolved";
  const isDiff = session?.artifact.type === "diff";

  // ── keyboard grammar: build state, reduce, dispatch ──
  const dispatch = (intent: Intent): void => {
    switch (intent.t) {
      case "exit":
        return void onExit?.(0);
      case "status":
        return controller.setStatus(intent.msg);
      case "move": {
        const len = isDiff ? rows.length : display.length;
        if (intent.to === "down") setCursor((c) => Math.min(len - 1, c + 1));
        else if (intent.to === "up") setCursor((c) => Math.max(0, c - 1));
        else if (intent.to === "top") setCursor(0);
        else setCursor(len - 1);
        return;
      }
      case "inboxMove": {
        const len = inbox?.length ?? 0;
        setInboxCursor((c) => (intent.to === "down" ? Math.min(len - 1, c + 1) : Math.max(0, c - 1)));
        return;
      }
      case "openSession": {
        const s = inbox?.[inboxCursor];
        if (s) controller.open(s.id);
        return;
      }
      case "startSpan": {
        const d = display[cursor];
        if (!d?.work) return;
        const span = startSpan(cursor, displayText(d));
        if (span) setMode({ m: "span", span });
        return;
      }
      case "spanKey":
        if (mode.m === "span") {
          setMode({ m: "span", span: spanKey(mode.span, intent.name, displayText(display[mode.span.dispIdx]!)) });
        }
        return;
      case "openCompose": {
        liveInput.current = "";
        if (intent.from === "span" && mode.m === "span") {
          setMode({
            m: "compose",
            kind: intent.kind,
            dispIdx: mode.span.dispIdx,
            start: mode.span.start,
            end: mode.span.end,
            text: "",
          });
        } else if (isDiff) {
          const row = rows[cursor];
          if (row) setMode({ m: "compose", kind: intent.kind, dispIdx: cursor, start: 0, end: row.text.length, text: "" });
        } else {
          const d = display[cursor];
          if (d) setMode({ m: "compose", kind: intent.kind, dispIdx: cursor, start: 0, end: displayText(d).length, text: "" });
        }
        return;
      }
      case "openSubmit":
        if (!session) return;
        liveInput.current = "";
        return void setMode({ m: "submit", verdict: defaultVerdict(session), summary: "" });
      case "cut":
        return controller.cut(cursor);
      case "edit":
        return controller.edit();
      case "nextAnn":
      case "prevAnn": {
        const anns = session?.annotations ?? [];
        if (!anns.length) return;
        const idx = anns.findIndex((a) => a.id === focusedAnn);
        const next = idx === -1 ? 0 : (idx + (intent.t === "nextAnn" ? 1 : -1) + anns.length) % anns.length;
        return void setFocusedAnn(anns[next]!.id);
      }
      case "removeAnnotation":
        if (focusedAnn) {
          controller.removeAnnotation(focusedAnn);
          setFocusedAnn(undefined);
        }
        return;
      case "closeOverlay":
        return void setMode({ m: "normal" });
      case "saveCompose": {
        if (mode.m !== "compose") return;
        const body = liveInput.current.trim();
        if (session && body) controller.annotate(mode.kind, mode.dispIdx, mode.start, mode.end, body);
        return void setMode({ m: "normal" });
      }
      case "submitVerdict":
        if (mode.m === "submit") controller.submit(mode.verdict, liveInput.current);
        return void setMode({ m: "normal" });
      case "cycleVerdict": {
        if (mode.m !== "submit") return;
        const idx = (VERDICTS.indexOf(mode.verdict) + intent.dir + VERDICTS.length) % VERDICTS.length;
        return void setMode({ ...mode, verdict: VERDICTS[idx]! });
      }
      case "finishReview":
        return controller.finishReview();
      case "optInAutoClose":
        return controller.optInAutoClose();
      case "dismissCompletion":
        return controller.dismissCompletion();
    }
  };

  useKeyboard((key) => {
    const state: KeyState = {
      keys: keysRef.current,
      readOnly,
      overlay:
        mode.m === "compose"
          ? "compose"
          : mode.m === "submit"
            ? "submit"
            : completion.phase === "prompt"
              ? "completion-prompt"
              : completion.phase === "counting"
                ? "completion-counting"
                : "none",
      view: !session ? "inbox" : isDiff ? "diff" : "plan",
      spanMode: mode.m === "span",
      resolved: !!resolved,
      hasInboxItems: !!inbox?.length,
      annotationCount: session?.annotations.length ?? 0,
      hasFocusedAnnotation: focusedAnn !== undefined,
      cursorAnnotatable: isDiff
        ? rows[cursor] !== undefined && rows[cursor]!.t !== "file" && rows[cursor]!.t !== "hunk"
        : !!display[cursor]?.work,
    };
    for (const intent of reduceKey(state, { name: key.name, shift: !!key.shift })) dispatch(intent);
  });

  // ── render ──────────────────────────────────
  if (error) return <text fg={T.red}>cueloop: {error}</text>;
  if (!session && !inbox) return <text fg={T.textDim}>connecting to the daemon…</text>;
  if (!session && inbox) return <Inbox inbox={inbox} cursor={inboxCursor} />;

  const s = session!;
  const pendingCount = s.annotations.length + (s.workingCopy !== undefined ? 1 : 0);

  if ((completion.phase === "prompt" || completion.phase === "counting") && s.verdict) {
    return (
      <CompletionOverlay
        verdict={s.verdict.kind}
        completion={completion}
        status={status}
        returnsTo={returnPaneFor(s.artifact.meta.herdrPane) ? (s.artifact.meta.agent ?? "the agent") : undefined}
      />
    );
  }

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: T.bg }}>
      <box style={{ height: 1, backgroundColor: T.panel, paddingLeft: 1, flexDirection: "row" }}>
        <text fg={T.text}>
          <span fg={T.accent}>cueloop</span>
          <span fg={T.textDim}> · {s.artifact.meta.title ?? s.artifact.meta.planPath ?? s.id} · rev {s.revisions.length}</span>
          {resolved ? <span fg={T.green}> · resolved: {s.verdict!.kind.replace("_", " ")}</span> : null}
          {readOnly ? <span fg={T.textDim}> · observer</span> : null}
          {status ? <span fg={T.accent}> · {status}</span> : null}
        </text>
      </box>
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        {isDiff ? (
          <DiffPane rows={rows} cursor={cursor} annotations={s.annotations} focusedAnn={focusedAnn} />
        ) : (
          <PlanPane display={display} marks={marks} cursor={cursor} mode={mode} />
        )}
        <Rail session={s} focusedAnn={focusedAnn} pendingCount={pendingCount} />
      </box>
      {mode.m === "compose" ? (
        <ComposeBar mode={mode} quote={isDiff ? (rows[mode.dispIdx]?.text ?? "") : displayText(display[mode.dispIdx]!).slice(mode.start, mode.end)} onChange={(text) => { liveInput.current = text; setMode({ ...mode, text }); }} />
      ) : mode.m === "submit" ? (
        <SubmitBar mode={mode} pendingCount={pendingCount} onChange={(summary) => { liveInput.current = summary; setMode({ ...mode, summary }); }} />
      ) : (
        <box style={{ height: 1, backgroundColor: T.panel, paddingLeft: 1 }}>
          <text fg={T.textDim}>
            {readOnly
              ? "observer - read-only · j/k move · n/p annotations · q quit"
              : mode.m === "span"
                ? "span · l/h grow/shrink · w/b slide · $ end · c comment · s suggest · esc"
                : "j/k move · v span · c comment · s suggest · x cut · e edit · n/p annotations · ⏎ submit · q quit"}
          </text>
        </box>
      )}
    </box>
  );
}

// ── panes ─────────────────────────────────────

function PlanPane({
  display,
  marks,
  cursor,
  mode,
}: {
  display: DisplayBlock[];
  marks: Map<number, { start: number; end: number; role: StyleRun["role"]; annotationId?: string }[]>;
  cursor: number;
  mode: Mode;
}): React.ReactNode {
  const width = 76;
  return (
    <scrollbox style={{ flexGrow: 1, paddingLeft: 2, paddingTop: 1 }} focused={false}>
      {display.map((d, i) => {
        const isCursor = i === cursor;
        const gap = topGap(display[i - 1], d);
        if (d.kind === "code") {
          return (
            <CodeBlock
              key={i}
              block={d}
              isCursor={isCursor}
              gap={gap}
              annotated={(marks.get(i) ?? []).length > 0}
            />
          );
        }
        const blockMarks = [...(marks.get(i) ?? [])];
        if (mode.m === "span" && mode.span.dispIdx === i) {
          blockMarks.push({ start: mode.span.start, end: mode.span.end, role: "kspan" });
        }
        const runs = overlayMarks(blockRuns(d, true), blockMarks);
        const lines = wrapRuns(runs, width - marker(d).length);
        return (
          <box key={i} style={{ flexDirection: "column", marginTop: gap }}>
            {lines.map((line, li) => (
              <text key={li} bg={isCursor ? T.cursorBg : undefined}>
                <span fg={isCursor ? T.accent : T.textDim}>{li === 0 ? cursorGlyph(isCursor) : "  "}</span>
                <span fg={T.textDim}>{li === 0 ? marker(d) : " ".repeat(marker(d).length)}</span>
                {line.map((r, ri) => (
                  <span key={ri} {...runStyle(r, d)}>
                    {r.text}
                  </span>
                ))}
                {li === 0 && d.type !== "same" ? <span fg={tagColor(d)}> [{tagLabel(d)}]</span> : null}
              </text>
            ))}
          </box>
        );
      })}
    </scrollbox>
  );
}

function CodeBlock({
  block,
  isCursor,
  gap,
  annotated,
}: {
  block: DisplayBlock;
  isCursor: boolean;
  gap: number;
  annotated: boolean;
}): React.ReactNode {
  const lang = (block.work ?? block.base)?.lang;
  const content = displayText(block);
  // Shiki tokens arrive async; plain verbatim lines render until then
  const [tokens, setTokens] = useState<CodeToken[][] | null>(null);
  useEffect(() => {
    let live = true;
    void highlightCode(content, lang).then((t) => {
      if (live && t) setTokens(t);
    });
    return () => {
      live = false;
    };
  }, [content, lang]);
  const lines: CodeToken[][] = tokens ?? content.split("\n").map((l) => [{ content: l }]);
  return (
    <box style={{ flexDirection: "column", marginTop: gap }}>
      <text>
        <span fg={isCursor ? T.accent : T.textDim}>{cursorGlyph(isCursor)}</span>
        <span fg={T.textDim}>{lang ?? "code"}</span>
        {annotated ? <span fg={T.accent}> ◆</span> : null}
        {block.type !== "same" ? <span fg={tagColor(block)}> [{tagLabel(block)}]</span> : null}
      </text>
      <box
        style={{
          flexDirection: "column",
          backgroundColor: T.elevated,
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
          marginLeft: 2,
        }}
      >
        {lines.map((line, li) => (
          <text key={li}>
            {line.length === 0 || (line.length === 1 && line[0]!.content === "") ? (
              " "
            ) : (
              line.map((tok, ti) => (
                <span key={ti} fg={tok.color ?? T.textMuted}>
                  {tok.content}
                </span>
              ))
            )}
          </text>
        ))}
      </box>
    </box>
  );
}

/** Vertical rhythm: gaps live ABOVE blocks so boundaries never collapse. */
function topGap(prev: DisplayBlock | undefined, cur: DisplayBlock): number {
  if (!prev) return 0;
  const tightPair =
    (cur.kind === "li" && prev.kind === "li") || (cur.kind === "oli" && prev.kind === "oli");
  return tightPair ? 0 : 1;
}

function Rail({
  session,
  focusedAnn,
  pendingCount,
}: {
  session: ReviewSession;
  focusedAnn?: string;
  pendingCount: number;
}): React.ReactNode {
  return (
    <box style={{ width: 34, backgroundColor: T.panel, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={T.textDim}>REVIEW ({pendingCount})</text>
      <text fg={T.textDim}>{session.workingCopy !== undefined ? "± plan edits → one diff" : "  no direct edits"}</text>
      <text> </text>
      {session.annotations.length === 0 ? (
        <text fg={T.textDim}>no annotations yet</text>
      ) : (
        session.annotations.map((a) => <AnnCard key={a.id} a={a} focused={a.id === focusedAnn} />)
      )}
      <box style={{ flexGrow: 1 }} />
      <text fg={session.status === "resolved" ? T.green : T.accent}>
        {session.status === "resolved" ? `resolved: ${session.verdict!.kind.replace("_", " ")}` : `Submit review (${pendingCount}) ⏎`}
      </text>
    </box>
  );
}

function AnnCard({ a, focused }: { a: Annotation; focused: boolean }): React.ReactNode {
  const color = a.kind === "suggestion" ? T.green : T.accent;
  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      <text fg={focused ? T.text : color}>
        {focused ? "▸ " : "  "}
        {a.kind.toUpperCase()}
      </text>
      <text fg={T.textDim}>  “{truncate(a.anchor.quote, 26)}”</text>
      <text fg={T.textMuted}>  {truncate(a.body, 28)}</text>
    </box>
  );
}

function Inbox({ inbox, cursor }: { inbox: ReviewSession[]; cursor: number }): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: T.bg, padding: 1 }}>
      <text fg={T.accent}>cueloop · inbox ({inbox.length} pending)</text>
      <text> </text>
      {inbox.length === 0 ? (
        <text fg={T.textDim}>nothing waiting for review</text>
      ) : (
        inbox.map((s, i) => (
          <text key={s.id} fg={i === cursor ? T.text : T.textMuted} bg={i === cursor ? T.cursorBg : undefined}>
            {i === cursor ? "▸ " : "  "}
            {s.artifact.meta.title ?? s.id} · {s.workspace.branch} · {s.artifact.type}
          </text>
        ))
      )}
      <box style={{ flexGrow: 1 }} />
      <text fg={T.textDim}>j/k move · ⏎ open · q quit</text>
    </box>
  );
}

function ComposeBar({
  mode,
  quote,
  onChange,
}: {
  mode: Extract<Mode, { m: "compose" }>;
  quote: string;
  onChange: (text: string) => void;
}): React.ReactNode {
  return (
    <box style={{ height: 2, backgroundColor: T.elevated, flexDirection: "column", paddingLeft: 1 }}>
      <text fg={mode.kind === "suggestion" ? T.green : T.accent}>
        {mode.kind === "suggestion" ? "SUGGEST REPLACEMENT FOR" : "COMMENT ON"} “{truncate(quote, 60)}” · ⏎ save · esc cancel
      </text>
      <input focused value={mode.text} onInput={onChange} />
    </box>
  );
}

function SubmitBar({
  mode,
  pendingCount,
  onChange,
}: {
  mode: Extract<Mode, { m: "submit" }>;
  pendingCount: number;
  onChange: (summary: string) => void;
}): React.ReactNode {
  return (
    <box style={{ height: 2, backgroundColor: T.elevated, flexDirection: "column", paddingLeft: 1 }}>
      <text>
        <span fg={T.textDim}>verdict ←/→ : </span>
        {VERDICTS.map((v, i) => (
          <span key={v} fg={v === mode.verdict ? verdictColor(v) : T.textDim}>
            {v === mode.verdict ? `[${VERDICT_LABEL[v]}]` : ` ${VERDICT_LABEL[v]} `}
            {i < VERDICTS.length - 1 ? " " : ""}
          </span>
        ))}
        <span fg={T.textDim}> · Submit review ({pendingCount}) on ⏎ · esc cancel</span>
      </text>
      <input focused value={mode.summary} onInput={onChange} placeholder="summary for the agent (optional)" />
    </box>
  );
}

function DiffPane({
  rows,
  cursor,
  annotations,
  focusedAnn,
}: {
  rows: DiffRow[];
  cursor: number;
  annotations: Annotation[];
  focusedAnn?: string;
}): React.ReactNode {
  // simple windowing: keep the cursor in view without a scroll dependency
  const windowStart = Math.max(0, cursor - 12);
  const visible = rows.slice(windowStart, windowStart + 200);
  const annotated = new Map<number, Annotation>();
  for (const a of annotations) {
    const idx = rows.findIndex((r) => r.text === a.anchor.quote && (r.t === "ctx" || r.t === "add" || r.t === "del"));
    if (idx !== -1) annotated.set(idx, a);
  }
  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      {visible.map((row, vi) => {
        const i = windowStart + vi;
        const isCursor = i === cursor;
        const ann = annotated.get(i);
        const gutter = row.t === "del" ? (row.oldLine?.toString() ?? "") : (row.newLine?.toString() ?? "");
        const sign = row.t === "add" ? "+" : row.t === "del" ? "-" : " ";
        if (row.t === "file") {
          return (
            <text key={i} fg={T.text} bg={isCursor ? T.cursorBg : T.panel}>
              {isCursor ? "▎" : " "}■ {row.text}
            </text>
          );
        }
        if (row.t === "hunk") {
          return (
            <text key={i} fg={T.blue} bg={isCursor ? T.cursorBg : undefined}>
              {isCursor ? "▎" : " "}{row.text}
            </text>
          );
        }
        const fg = row.t === "add" ? T.insFg : row.t === "del" ? T.delFg : T.textMuted;
        return (
          <box key={i} style={{ flexDirection: "column" }}>
            <text bg={isCursor ? T.cursorBg : ann ? T.markCommentBg : undefined}>
              <span fg={T.textDim}>{isCursor ? "▎" : " "}{gutter.padStart(4)} </span>
              <span fg={fg}>{sign}{row.text}</span>
            </text>
            {ann ? (
              <text>
                <span fg={T.textDim}>{"      "}</span>
                <span fg={ann.id === focusedAnn ? T.text : T.accent}>◆ {truncate(ann.body, 70)}</span>
              </text>
            ) : null}
          </box>
        );
      })}
    </box>
  );
}

function CompletionOverlay({
  verdict,
  completion,
  status,
  returnsTo,
}: {
  verdict: VerdictKind;
  completion: { phase: "prompt" } | { phase: "counting"; remaining: number };
  /** Latest status line (e.g. the vault-export path) stays visible here. */
  status: string;
  /** Where focus goes on close (the agent's herdr pane), when known. */
  returnsTo?: string;
}): React.ReactNode {
  const approved = verdict === "approve";
  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: T.bg,
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <text fg={approved ? T.green : T.accent}>{approved ? "✓ review approved" : "✎ feedback sent"}</text>
      <text> </text>
      <text fg={T.text}>The agent has your {approved ? "approval" : "feedback"} and is unblocked.</text>
      {status ? <text fg={T.textDim}>{status}</text> : null}
      <text> </text>
      {completion.phase === "counting" ? (
        <text fg={T.textDim}>
          closing in {completion.remaining}s{returnsTo ? ` - returning to ${returnsTo}` : ""} · ⏎ now · esc stay
        </text>
      ) : (
        <text fg={T.textDim}>⏎ close · a always close after submit (3s) · esc stay</text>
      )}
    </box>
  );
}

// ── small helpers ─────────────────────────────

function marker(d: DisplayBlock): string {
  if (d.kind === "li") return "- ";
  if (d.kind === "oli") return `${d.oliNum ?? 1}. `;
  if (d.kind === "quote") return "▏ ";
  return "";
}

function cursorGlyph(isCursor: boolean): string {
  return isCursor ? "▎ " : "  ";
}

function tagLabel(d: DisplayBlock): string {
  return d.type === "del" ? "cut" : d.type === "add" ? "new" : "edited";
}

function tagColor(d: DisplayBlock): string {
  return d.type === "del" ? T.red : d.type === "add" ? T.green : T.accent;
}

function verdictColor(v: VerdictKind): string {
  return v === "approve" ? T.green : v === "request_changes" ? T.red : T.blue;
}

function defaultVerdict(s: ReviewSession): VerdictKind {
  return s.annotations.length || s.workingCopy !== undefined ? "request_changes" : "approve";
}

function runStyle(r: StyleRun, d: DisplayBlock): { fg?: string; bg?: string; attributes?: number } {
  const headingFg = d.kind === "h1" ? T.text : d.kind === "h2" || d.kind === "h3" ? T.accent : undefined;
  const struck = d.type === "del";
  switch (r.role) {
    case "ins":
      return { fg: T.insFg };
    case "del":
      return { fg: T.delFg };
    case "mark-comment":
      return { fg: T.text, bg: T.markCommentBg };
    case "mark-suggestion":
      return { fg: T.text, bg: T.markSuggestionBg };
    case "mark-focus":
      return { fg: T.accentInk, bg: T.accent };
    case "kspan":
      return { fg: T.accentInk, bg: T.accent };
    default:
      return { fg: struck ? T.red : (headingFg ?? (d.kind === "code" ? T.textMuted : T.text)) };
  }
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\n/g, " ");
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}
