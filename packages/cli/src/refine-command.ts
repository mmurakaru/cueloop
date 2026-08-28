import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cueloopHome, reportsDir } from "@cueloop/daemon/paths";
import { SessionStore } from "@cueloop/daemon/store";
import {
  LATEST_REPORT_FILENAME,
  parseRefineState,
  pruneExpiredReports,
  resolveCleanupPeriodDays,
  timestampedReportFilename,
} from "@cueloop/daemon/retention";
import { isAgentNote, type Annotation, type ReviewSession } from "@cueloop/schema";
import { parseArgs, stringFlag } from "./args";

const DEFAULT_SESSION_LIMIT = 200;
const QUOTE_LIMIT = 60;
const BODY_LIMIT = 100;

interface AnnotatedEntry {
  annotation: Annotation;
  session: ReviewSession;
}

export async function refineCommand(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv);
  const home = stringFlag(flags, "home") ?? cueloopHome();
  const limit = parseLimit(stringFlag(flags, "limit"));
  const nowMs = Date.now();

  const store = new SessionStore(home);

  store.recover();
  const all = store.list();

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

  console.log(
    JSON.stringify(
      {
        report: latestPath,
        timestamped: timestampedPath,
        analyzed: analyzed.length,
        total: all.length,
      },
      null,
      2,
    ),
  );

  return 0;
}

export function buildRefineReport(
  analyzed: ReviewSession[],
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
    "By verdict:",
    ...byCount(analyzed, verdictLabel).map(([label, count]) => `- ${label}: ${count}`),
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
          verdictLabel(session),
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
    "Rank each pattern by how often its members sit on a request-changes or comment verdict.",
    "Draft one writeback per pattern, routed to a skill, AGENTS.md, CLAUDE.md, or memory.",
    "",
  );

  return lines.join("\n");
}

function hasReviewSignal(session: ReviewSession): boolean {
  return (
    session.verdict !== null || session.annotations.some((annotation) => !isAgentNote(annotation))
  );
}

function flattenReviewAnnotations(sessions: ReviewSession[]): AnnotatedEntry[] {
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

function primitiveLabel(session: ReviewSession): string {
  if (session.artifact.type === "diff" && session.artifact.meta.pr) return "pull request";

  return session.artifact.type;
}

function verdictLabel(session: ReviewSession): string {
  switch (session.verdict?.kind) {
    case "approve":
      return "approve";
    case "request_changes":
      return "request changes";
    case "comment":
      return "comment";
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

function parseLimit(raw: string | undefined): number {
  const value = Number(raw);

  return Number.isInteger(value) && value > 0 ? value : DEFAULT_SESSION_LIMIT;
}

function analysisFingerprint(session: ReviewSession): string {
  return `${session.revisions.length}:${session.annotations.length}:${session.verdict?.resolvedAt ?? "pending"}`;
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
