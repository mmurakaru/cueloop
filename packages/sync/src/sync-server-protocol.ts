import type { SyncWorkspaceTransferAdapter } from "./sync-transfer-adapter.ts";
import type { SyncWorkspaceAuthority } from "./sync-authority-protocol.ts";
import type { syncAuthorityReplicaConfiguration } from "./sync-restore.ts";
import type { SyncTextEditorSession } from "./sync-text-session.ts";
import * as v from "valibot";

export type SyncClientOutcome =
  | { status: "completed" }
  | { status: "interrupted"; signal: "SIGINT" | "SIGTERM" };

export interface SyncApplication {
  fetch: (request: Request) => Response | Promise<Response>;
  connect?: (arguments_: string[]) => Promise<void | SyncClientOutcome>;
  execute?: (arguments_: string[]) => Promise<void | SyncClientOutcome>;
  openText?: (arguments_: string[]) => Promise<SyncTextEditorSession>;
  verifyReplica?: (
    configuration: ReturnType<typeof syncAuthorityReplicaConfiguration>,
  ) => Promise<void>;
  transferAdapter?: SyncWorkspaceTransferAdapter;
  verifyWorkspaceReplica?: (authority: SyncWorkspaceAuthority) => Promise<void>;
  readiness?: (signal: AbortSignal) => SyncServerReadiness | Promise<SyncServerReadiness>;
  close?: (signal?: AbortSignal) => void | Promise<void>;
}

export const SyncServerReadinessSchema = v.pipe(
  v.object({
    ready: v.boolean(),
    phase: v.picklist([
      "initializing",
      "active",
      "recovering",
      "fenced",
      "storage-failed",
      "unavailable",
      "closing",
      "closed",
    ]),
  }),
  v.check(
    (state) => !state.ready || state.phase === "active",
    "Only an active authority can be ready",
  ),
);

export type SyncServerReadiness = v.InferOutput<typeof SyncServerReadinessSchema>;
