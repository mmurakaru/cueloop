import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionStore } from "./store";

export const DEFAULT_CLEANUP_PERIOD_DAYS = 30;
export const LATEST_REPORT_FILENAME = "report.md";
export const TIMESTAMPED_REPORT_PREFIX = "refine-";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function userConfigPath(env: NodeJS.ProcessEnv): string {
  const explicit = env.CUELOOP_CONFIG;
  if (explicit && explicit.trim()) return explicit;
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  const base = xdgConfigHome && xdgConfigHome.trim() ? xdgConfigHome : join(homedir(), ".config");
  return join(base, "cueloop", "config.toml");
}

function readConfiguredPeriodDays(path: string): number | undefined {
  let raw: Record<string, unknown>;
  try {
    raw = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const cleanup = raw["cleanup"] as Record<string, unknown> | undefined;
  const value = cleanup?.["period_days"];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function resolveCleanupPeriodDays(env: NodeJS.ProcessEnv = process.env): number {
  return readConfiguredPeriodDays(userConfigPath(env)) ?? DEFAULT_CLEANUP_PERIOD_DAYS;
}

export function isExpired(createdAt: string, periodDays: number, nowMs: number): boolean {
  if (periodDays <= 0) return false;
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return false;
  return nowMs - createdMs > periodDays * MILLISECONDS_PER_DAY;
}

export function pruneExpiredSessions(
  store: SessionStore,
  periodDays: number,
  nowMs: number,
): string[] {
  if (periodDays <= 0) return [];
  const pruned: string[] = [];
  for (const session of store.list()) {
    if (session.status !== "resolved") continue;
    if (isExpired(session.createdAt, periodDays, nowMs) && store.delete(session.id)) {
      pruned.push(session.id);
    }
  }
  return pruned;
}

export function timestampedReportFilename(nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, "-");
  return `${TIMESTAMPED_REPORT_PREFIX}${stamp}.md`;
}

export function pruneExpiredReports(
  reportsDirectory: string,
  periodDays: number,
  nowMs: number,
): string[] {
  if (periodDays <= 0) return [];
  let entries: string[];
  try {
    entries = readdirSync(reportsDirectory);
  } catch {
    return [];
  }
  const cutoffMs = nowMs - periodDays * MILLISECONDS_PER_DAY;
  const pruned: string[] = [];
  for (const entry of entries) {
    if (entry === LATEST_REPORT_FILENAME) continue;
    if (!entry.startsWith(TIMESTAMPED_REPORT_PREFIX)) continue;
    const path = join(reportsDirectory, entry);
    if (statSync(path).mtimeMs < cutoffMs) {
      rmSync(path, { force: true });
      pruned.push(entry);
    }
  }
  return pruned;
}
