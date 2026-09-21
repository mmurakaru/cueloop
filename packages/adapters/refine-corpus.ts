import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cueloopHome, reportsDir } from "@cueloop/daemon/paths";
import type { ThreadSessionClient } from "@cueloop/daemon/thread-review";
import {
  LATEST_REPORT_FILENAME,
  parseRefineState,
  pruneExpiredReports,
  resolveCleanupPeriodDays,
  timestampedReportFilename,
} from "@cueloop/daemon/retention";
import { isAgentNote, type Annotation, type Thread } from "@cueloop/schema";
import type { RefineCorpusPort } from "./harness-thread-controller";

const DEFAULT_SESSION_LIMIT = 200;
const QUOTE_LIMIT = 60;
const BODY_LIMIT = 100;

interface AnnotatedEntry {
  annotation: Annotation;
  session: Thread;
}

/** A corpus report plus its persisted paths and counts. */
export interface RefineCorpusAnalysis {
  report: string;
  reportPath: string;
  timestampedPath: string;
  analyzed: number;
  total: number;
}

/** Local corpus implementation shared with the refine CLI command. */
export class LocalRefineCorpusPort implements RefineCorpusPort {
  constructor(
    private readonly client: Pick<ThreadSessionClient, "sessionList">,
    private readonly home = cueloopHome(),
    private readonly limit?: number,
  ) {}

  async analyzeRefineCorpus(): Promise<RefineCorpusAnalysis> {
    const sessions = await this.client.sessionList();

    return analyzeRefineCorpus(sessions, this.home, this.limit);
  }
}

/** Analyze stored Threads and persist the report without editing their artifacts. */
export function analyzeRefineCorpus(
  all: Thread[],
  home = cueloopHome(),
  requestedLimit?: number,
  nowMs = Date.now(),
): RefineCorpusAnalysis {
  const limit = parseLimit(requestedLimit);

  const analyzedState = readState(home);
  const fresh = all.filter(
    (session) => analyzedState.get(session.id) !== analysisFingerprint(session),
  );
  const analyzed = fresh.filter(hasReviewSignal).slice(0, limit);

  const markdown = buildRefineReport(analyzed, all.length, new Date(nowMs).toISOString());

  const directory = reportsDir(home);

  mkdirSync(directory, { recursive: true });
  pruneExpiredReports(directory, resolveCleanupPeriodDays(), nowMs);
  const latestPath = join(directory, LATEST_REPORT_FILENAME);
  const timestampedPath = join(directory, timestampedReportFilename(nowMs));

  writeFileSync(latestPath, markdown);
  writeFileSync(timestampedPath, markdown);

  for (const session of analyzed) {
    if (session.status === "resolved") analyzedState.set(session.id, analysisFingerprint(session));
  }
  writeState(home, analyzedState);

  return {
    report: markdown,
    reportPath: latestPath,
    timestampedPath,
    analyzed: analyzed.length,
    total: all.length,
  };
}

export function buildRefineReport(
  analyzed: Thread[],
  totalCount: number,
  generatedAt: string,
): string {
  const entries = flattenReviewAnnotations(analyzed);
  const lines: string[] = [
    "# refine report",
    "",
    `Generated ${generatedAt}.`,
    "",
    `${analyzed.length} sessions analyzed (${totalCount} total).`,
    "",
    "## Corpus",
    "",
    "By primitive:",
    ...byCount(analyzed, primitiveLabel).map(([label, count]) => `- ${label}: ${count}`),
    "",
    "By message:",
    ...byCount(analyzed, messageLabel).map(([label, count]) => `- ${label}: ${count}`),
    "",
    "## Annotations by kind",
    "",
  ];

  if (entries.length === 0) {
    lines.push("No reviewer annotations in the analyzed sessions.", "");
  } else {
    for (const [kind, group] of groupByKind(entries)) {
      lines.push(`### ${kind} (${group.length})`, "");
      for (const { annotation, session } of group) {
        const meta = [
          session.id,
          primitiveLabel(session),
          messageLabel(session),
          isoWeek(annotation.createdAt),
        ].join(" · ");

        lines.push(
          `- "${truncate(annotation.anchor.quote, QUOTE_LIMIT)}": ${truncate(annotation.body, BODY_LIMIT)} · ${meta}`,
        );
      }
      lines.push("");
    }
  }

  lines.push("## Weekly volume", "");
  for (const [week, count] of byKey(
    entries.map((entry) => entry.annotation),
    (annotation) => isoWeek(annotation.createdAt),
  )) {
    lines.push(`- ${week}: ${count}`);
  }
  lines.push(
    "",
    "## Next",
    "",
    "Group the annotations above into named patterns of three or more members.",
    "Rank each pattern by how often its members sit on a changes-requested message.",
    "Draft one writeback per pattern, routed to a skill, AGENTS.md, CLAUDE.md, or memory.",
    "",
  );

  return lines.join("\n");
}

function hasReviewSignal(session: Thread): boolean {
  return (
    session.message !== null || session.annotations.some((annotation) => !isAgentNote(annotation))
  );
}

function flattenReviewAnnotations(sessions: Thread[]): AnnotatedEntry[] {
  const entries: AnnotatedEntry[] = [];

  for (const session of sessions) {
    for (const annotation of session.annotations) {
      if (!isAgentNote(annotation)) entries.push({ annotation, session });
    }
  }

  return entries;
}

function groupByKind(entries: AnnotatedEntry[]): [string, AnnotatedEntry[]][] {
  const groups = new Map<string, AnnotatedEntry[]>();

  for (const entry of entries) {
    const group = groups.get(entry.annotation.kind) ?? [];

    group.push(entry);
    groups.set(entry.annotation.kind, group);
  }

  return [...groups.entries()].toSorted(
    (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]),
  );
}

function byCount<T>(items: T[], keyOf: (item: T) => string): [string, number][] {
  return [...tally(items, keyOf).entries()].toSorted(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

function byKey<T>(items: T[], keyOf: (item: T) => string): [string, number][] {
  return [...tally(items, keyOf).entries()].toSorted((left, right) =>
    left[0].localeCompare(right[0]),
  );
}

function tally<T>(items: T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = keyOf(item);

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function primitiveLabel(session: Thread): string {
  if (session.artifact.type === "diff" && session.artifact.meta.pr) return "pull request";

  return session.artifact.type;
}

function messageLabel(session: Thread): string {
  switch (session.message?.outcome) {
    case "approved":
      return "approved";
    case "changes_requested":
      return "request changes";
    default:
      return "none";
  }
}

function isoWeek(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "undated";
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = utc.getUTCDay() || 7;

  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000) + 1) / 7);

  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();

  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function parseLimit(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_SESSION_LIMIT;
}

function analysisFingerprint(session: Thread): string {
  return `${session.revisions.length}:${session.annotations.length}:${session.message?.sentAt ?? "pending"}`;
}

function statePath(home: string): string {
  return join(home, "refine-state.json");
}

function readState(home: string): Map<string, string> {
  try {
    return parseRefineState(JSON.parse(readFileSync(statePath(home), "utf8")));
  } catch {
    return new Map();
  }
}

function writeState(home: string, analyzed: Map<string, string>): void {
  const state = { analyzed: Object.fromEntries(analyzed) };

  writeFileSync(statePath(home), JSON.stringify(state, null, 2));
}
