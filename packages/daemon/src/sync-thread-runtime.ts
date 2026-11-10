import {
  createSyncThreadProfile,
  type SyncThreadProfile,
  type ConnectedSyncThreadProfile,
} from "./sync-thread-profile";
import type { Thread } from "@cueloop/schema";
import { createSyncThreadDiffLifecycle } from "./sync-thread-diff-refresh";
import { isDeepStrictEqual } from "node:util";
import type { SyncDraftRecord } from "@cueloop/sync/drafts";
import { createSyncQuerySubscription } from "@cueloop/sync/queries";
import { submitSyncOperation, type SyncOperationReceipt } from "@cueloop/sync/operations";
import * as v from "valibot";
import type { DaemonCore } from "./api";
import { ThreadStore } from "./store";
import { ThreadRecordSchema } from "./validate";
import { DaemonError } from "./errors";
import { syncThreadQueries } from "./sync-thread-queries";
import { syncThreadMutators } from "./sync-thread-mutators";
import {
  prepareSyncThreadCommand,
  prepareSyncThreadImport,
  SyncThreadImportUploadSchema,
  SyncThreadCommandUploadSchema,
  syncThreadOperations,
  SyncThreadCommandSchema,
  type SyncThreadCommand,
  type SyncThreadDelegationSchema,
} from "./sync-thread-protocol";
import type { SyncThreadConnection } from "./sync-thread-local-state";
import {
  lookupSyncThreadOperation,
  uploadSyncThreadCommand,
  uploadSyncThreadImport,
} from "./sync-thread-import-client";

const PreparedCommandSchema = v.variant("kind", [
  v.object({ kind: v.literal("inline"), operation: syncThreadOperations.command.schema }),
  v.object({
    kind: v.literal("staged"),
    operation: syncThreadOperations.stagedCommand.schema,
    upload: SyncThreadCommandUploadSchema,
  }),
]);
const CommandResultSchema = v.object({
  recordIdentifier: v.string(),
  threadIdentifier: v.optional(v.string()),
  version: v.optional(v.pipe(v.number(), v.safeInteger())),
  messageIdentifier: v.optional(v.string()),
  deleted: v.optional(v.boolean()),
});

interface ThreadObservation {
  profile: ConnectedSyncThreadProfile;
  version: number;
  failure?: Error;
  changed: Set<() => void>;
  close(): void;
}

/** Files contain only projections and journals; every supported mutation crosses the workspace authority. */
export class SyncThreadRuntime {
  private readonly profiles = new Map<string, SyncThreadProfile>();
  private readonly observations = new Map<string, ThreadObservation>();
  private readonly store: ThreadStore;
  private closed = false;

  constructor(
    private readonly options: {
      home: string;
      core: DaemonCore;
      enabled(thread: Thread): boolean;
      onDelete?(threadIdentifier: string): Promise<void>;
    },
  ) {
    if (!(options.core.store instanceof ThreadStore))
      throw new Error("Sync Thread runtime requires its local projection repository");

    this.store = options.core.store;
    options.core.setSyncDiffLifecycle(
      createSyncThreadDiffLifecycle({
        read: (id) => ({
          thread: options.core.sessionGet(id),
          version: this.store.syncState.projectionVersion(id),
        }),
        commit: async (thread, version) => {
          await this.command(
            {
              method: "session.applyDiffCapture",
              parameters: { id: thread.id, snapshot: JSON.stringify(thread) },
            },
            undefined,
            version,
          );
        },
      }),
    );
  }

  private isEnabled(threadIdentifier: string): boolean {
    const thread =
      this.store.get(threadIdentifier) ??
      this.store.syncState.readProjection(threadIdentifier).thread;

    return this.options.enabled(thread);
  }

  private assertEnabled(threadIdentifier: string): void {
    if (this.closed) throw new DaemonError("sync_closed", "Sync Thread runtime is closed");

    if (!this.isEnabled(threadIdentifier))
      throw new DaemonError(
        "sync_disabled",
        "Multiplayer sync is experimental; enable it in Settings > Experimental; this Thread remains a read-only projection",
      );
  }

  private profile(connection: SyncThreadConnection): SyncThreadProfile {
    const key = JSON.stringify({
      ...connection,
      recordIdentifier: undefined,
    });
    const existing = this.profiles.get(key);

    if (existing) return existing;

    const authenticationToken = process.env[connection.authenticationTokenEnvironment];

    if (!authenticationToken)
      throw new DaemonError(
        "sync_credentials_missing",
        "Sync Thread credentials are missing from the configured environment variable",
      );

    const profile = createSyncThreadProfile({
      home: this.options.home,
      connection,
      authenticationToken,
    });

    this.profiles.set(key, profile);

    return profile;
  }

  private async observe(
    threadIdentifier: string,
    acceptRecovery = false,
  ): Promise<ThreadObservation> {
    this.assertEnabled(threadIdentifier);
    const manifest = this.store.syncState.read(threadIdentifier);
    const profile = await this.profile(manifest.connection).connect();
    const existing = this.observations.get(threadIdentifier);

    if (existing && !existing.failure && existing.profile.client === profile.client)
      return existing;

    existing?.close();
    const query = syncThreadQueries.ownerDocument({
      workspaceIdentifier: manifest.connection.workspaceIdentifier,
      recordIdentifier: manifest.connection.recordIdentifier,
    });
    const subscription = createSyncQuerySubscription({
      client: profile.client,
      view: profile.client.materialize(query),
      maximumBytes: 64 * 1024 * 1024,
    });
    const observation: ThreadObservation = {
      profile,
      version: 0,
      changed: new Set(),
      close: () => subscription.close(),
    };

    this.observations.set(threadIdentifier, observation);
    void (async () => {
      try {
        for await (const snapshot of subscription) {
          if (this.observations.get(threadIdentifier) !== observation) break;

          if (this.closed || !this.isEnabled(threadIdentifier)) {
            subscription.close();
            throw new DaemonError(
              "sync_disabled",
              "Sync Thread observation is disabled; its cached projection remains read-only",
            );
          }

          if (snapshot.freshness !== "complete" || snapshot.connection !== "connected") continue;

          if (!snapshot.data?.thread)
            throw new DaemonError(
              "sync_access_revoked",
              "Sync Thread owner access was removed or the Thread was deleted",
            );

          const thread = v.parse(ThreadRecordSchema, snapshot.data.document);

          if (thread.id !== threadIdentifier)
            throw new Error("Sync Thread authority returned a different application identity");

          if (observation.version === snapshot.data.thread.version) continue;

          this.options.core.sessionProjectSyncThread(thread, snapshot.data.thread.version, {
            authority: profile.authority,
            acceptRecovery,
          });
          observation.version = snapshot.data.thread.version;

          for (const notify of observation.changed) notify();
        }
      } catch (cause) {
        observation.failure =
          cause instanceof Error ? cause : new Error("Sync Thread observation failed");

        for (const notify of observation.changed) notify();
      } finally {
        subscription.close();
      }
    })();

    return observation;
  }

  private async waitForProjection(observation: ThreadObservation, version: number): Promise<void> {
    if (observation.failure) throw observation.failure;

    if (observation.version >= version) return;

    const ready = Promise.withResolvers<void>();
    const notify = () => {
      if (observation.failure) ready.reject(observation.failure);
      else if (observation.version >= version) ready.resolve();
    };
    const timer = setTimeout(
      () =>
        ready.reject(
          new DaemonError(
            "sync_projection_pending",
            "Sync Thread acceptance is pending projection recovery; its operation identity is retained",
          ),
        ),
      30000,
    );

    observation.changed.add(notify);
    notify();

    try {
      await ready.promise;
    } finally {
      clearTimeout(timer);
      observation.changed.delete(notify);
    }
  }

  async importThread(
    threadIdentifier: string,
    connection: Omit<SyncThreadConnection, "recordIdentifier">,
  ) {
    this.assertEnabled(threadIdentifier);

    if (this.store.syncState.isFenced(threadIdentifier))
      return this.retryImport(threadIdentifier, connection);

    const profile = await this.profile({ ...connection, recordIdentifier: "" }).connect();
    const workspace = await profile.client.run(
      syncThreadQueries.workspace({ workspaceIdentifier: connection.workspaceIdentifier }),
      { type: "complete" },
    );

    if (
      !workspace?.memberships.some(
        (member) =>
          member.actorIdentifier === connection.actorIdentifier && member.role === "owner",
      )
    )
      throw new DaemonError(
        "forbidden",
        "Sync Thread import requires current workspace owner access",
      );

    const upload = await prepareSyncThreadImport({
      workspaceIdentifier: connection.workspaceIdentifier,
      authority: profile.authority,
      thread: this.options.core.sessionGet(threadIdentifier),
    });

    this.options.core.sessionFenceForSync({
      id: threadIdentifier,
      snapshot: upload.snapshot,
      connection: { ...connection, recordIdentifier: upload.operation.arguments.recordIdentifier },
      upload: JSON.stringify(upload),
    });

    return this.resume(threadIdentifier);
  }

  private async retryImport(
    threadIdentifier: string,
    connection: Omit<SyncThreadConnection, "recordIdentifier">,
  ) {
    const manifest = this.store.syncState.read(threadIdentifier);
    const { recordIdentifier: _recordIdentifier, ...savedConnection } = manifest.connection;

    if (!isDeepStrictEqual(connection, savedConnection))
      throw new DaemonError(
        "sync_authority_conflict",
        "Sync Thread import cannot change its saved authority connection; use an explicit authority transfer",
      );

    if (manifest.phase === "remote") return this.resume(threadIdentifier);

    const profile = await this.profile(manifest.connection).connect();
    const previous = v.parse(
      SyncThreadImportUploadSchema,
      JSON.parse(this.store.syncState.readUpload(threadIdentifier)),
    );
    const receipt = await lookupSyncThreadOperation({
      authorityURL: connection.authorityURL,
      authenticationToken: profile.authenticationToken,
      operation: previous.operation,
    });

    if (!receipt || receipt.status === "accepted") return this.resume(threadIdentifier);

    const operation = syncThreadOperations.import.create({
      workspaceIdentifier: previous.operation.workspaceIdentifier,
      authority: profile.authority,
      arguments: previous.operation.arguments,
    });
    const upload = v.parse(SyncThreadImportUploadSchema, { ...previous, operation });

    this.store.syncState.replaceRejectedUpload(threadIdentifier, JSON.stringify(upload));

    return this.resume(threadIdentifier);
  }

  async resume(threadIdentifier: string, acceptRecovery = false) {
    this.assertEnabled(threadIdentifier);
    const manifest = this.store.syncState.read(threadIdentifier);
    const profile = await this.profile(manifest.connection).connect();

    if (manifest.phase === "importing") {
      const upload = v.parse(
        SyncThreadImportUploadSchema,
        JSON.parse(this.store.syncState.readUpload(threadIdentifier)),
      );
      let receipt = await lookupSyncThreadOperation({
        authorityURL: manifest.connection.authorityURL,
        authenticationToken: profile.authenticationToken,
        operation: upload.operation,
      });

      if (!receipt) {
        await uploadSyncThreadImport({
          authorityURL: manifest.connection.authorityURL,
          authenticationToken: profile.authenticationToken,
          upload,
        });
        const outcome = await submitSyncOperation({
          operation: upload.operation,
          submit: (operation) => profile.client.mutate(syncThreadMutators.thread.import(operation)),
          lookup: (operation) =>
            lookupSyncThreadOperation({
              authorityURL: manifest.connection.authorityURL,
              authenticationToken: profile.authenticationToken,
              operation,
            }),
        });

        if (outcome.status === "pending")
          throw new DaemonError(
            "sync_import_pending",
            "Sync Thread import acknowledgement is pending; resume with its saved operation identity",
          );

        if (outcome.status === "recovery-required")
          throw new DaemonError(
            "sync_recovery_required",
            "Sync Thread import outcome is unknown after recovery; its saved operation and snapshot are retained",
          );

        receipt = outcome;
      }

      if (receipt.status === "rejected")
        throw new DaemonError(
          "sync_import_rejected",
          "Sync Thread import was rejected; the original snapshot remains saved behind its authority fence",
        );
    }

    const observation = await this.observe(threadIdentifier, acceptRecovery);

    await this.waitForProjection(observation, 1);

    return this.options.core.sessionGet(threadIdentifier);
  }

  async route(
    request: { method: string; params?: unknown },
    peer: { role: "owner" | "collaborator" | "agent"; author?: string },
  ) {
    const parsed = v.safeParse(SyncThreadCommandSchema, {
      method: request.method,
      parameters: request.params,
    });

    if (!parsed.success) return { handled: false as const };

    const command = parsed.output;
    const author =
      peer.author ??
      (command.method === "session.annotate" || command.method === "session.comment"
        ? command.parameters.annotation.author
        : undefined);

    if (peer.role !== "owner" && !author)
      throw new DaemonError(
        "forbidden",
        "Sync Thread comment mediation requires the connection's bound author",
      );

    const result = await this.command(
      command,
      peer.role !== "owner" && author ? { actorIdentifier: author, scope: "comments" } : undefined,
    );

    return { handled: true as const, result: command.method === "session.delete" ? {} : result };
  }

  async command(
    command: SyncThreadCommand,
    delegation?: v.InferOutput<typeof SyncThreadDelegationSchema>,
    capturedVersion?: number,
  ) {
    const threadIdentifier = command.parameters.id;

    this.assertEnabled(threadIdentifier);
    const manifest = this.store.syncState.read(threadIdentifier);

    if (manifest.phase !== "remote")
      throw new DaemonError(
        "sync_import_pending",
        "Sync Thread import must complete before accepting new changes",
      );

    const observation = await this.observe(threadIdentifier);

    await this.waitForProjection(observation, 1);
    const connection = manifest.connection;
    const prepared = await prepareSyncThreadCommand({
      ...connection,
      authority: observation.profile.authority,
      expectedVersion:
        capturedVersion ??
        Math.max(observation.version, this.store.syncState.projectionVersion(threadIdentifier)),
      command,
      delegation,
    });
    const draft = await observation.profile.drafts.save({ content: JSON.stringify(prepared) });

    await observation.profile.drafts.markSubmitted({
      draftIdentifier: draft.draftIdentifier,
      operation: prepared.operation,
    });
    await this.resume(threadIdentifier);

    return this.finishCommand(threadIdentifier, draft.draftIdentifier, prepared);
  }

  private async retireDeletedProjection(threadIdentifier: string): Promise<void> {
    this.observations.get(threadIdentifier)?.close();

    if (this.store.get(threadIdentifier)) await this.options.onDelete?.(threadIdentifier);

    this.options.core.sessionRemoveSyncProjection(threadIdentifier);
  }

  private async finishCommand(
    threadIdentifier: string,
    draftIdentifier: SyncDraftRecord["draftIdentifier"],
    prepared: v.InferOutput<typeof PreparedCommandSchema>,
    knownReceipt?: SyncOperationReceipt,
  ) {
    const connection = this.store.syncState.read(threadIdentifier).connection;
    const profile = await this.profile(connection).connect();
    const outcome =
      knownReceipt ?? (await this.submitPreparedCommand(profile, connection, prepared));

    if (outcome.status === "pending")
      throw new DaemonError(
        "sync_command_pending",
        "Sync Thread command acknowledgement is pending; its draft and operation identity are retained",
      );

    if (outcome.status === "recovery-required")
      throw new DaemonError(
        "sync_recovery_required",
        "Sync Thread command outcome is unknown after recovery; its original draft and operation are retained",
      );

    await profile.drafts.recordReceipt({
      draftIdentifier,
      receipt: outcome,
    });

    if (outcome.status === "rejected")
      throw new DaemonError(
        outcome.reason.status === "retained" ? outcome.reason.code : "sync_command_rejected",
        "Sync Thread command was rejected; its original input remains saved as a draft",
      );

    if (outcome.result.status !== "retained")
      throw new DaemonError(
        "sync_result_expired",
        "Sync Thread command result expired; recover the authoritative Thread",
      );

    const result = v.parse(CommandResultSchema, outcome.result.value);

    if (result.deleted) {
      await this.retireDeletedProjection(threadIdentifier);
      await profile.drafts.discard(draftIdentifier);

      return null;
    }

    if (result.threadIdentifier && result.threadIdentifier !== threadIdentifier) {
      const record = await profile.client.run(
        syncThreadQueries.ownerDocument({
          workspaceIdentifier: connection.workspaceIdentifier,
          recordIdentifier: result.recordIdentifier,
        }),
        { type: "complete" },
      );

      if (!record?.thread)
        throw new DaemonError(
          "sync_fork_pending",
          "Sync Thread fork was accepted; resume its saved operation to recover the fork",
        );

      const fork = v.parse(ThreadRecordSchema, record.document);

      if (fork.id !== result.threadIdentifier)
        throw new Error("Sync Thread fork returned a different application identity");

      if (!this.store.syncState.isFenced(fork.id))
        this.store.syncState.begin({
          thread: fork,
          connection: { ...connection, recordIdentifier: result.recordIdentifier },
          upload: "",
          phase: "remote",
          version: record.thread.version,
          authority: profile.authority,
        });

      this.options.core.sessionProjectSyncThread(fork, record.thread.version, {
        authority: profile.authority,
      });
      await profile.drafts.discard(draftIdentifier);
      await this.observe(fork.id);

      return fork;
    }

    const observation = await this.observe(threadIdentifier);

    await this.waitForProjection(observation, result.version ?? observation.version);
    await profile.drafts.discard(draftIdentifier);
    const thread = this.options.core.sessionGet(threadIdentifier);
    const previousMessage = result.messageIdentifier
      ? thread.messageOperations?.find((receipt) => receipt.result.id === result.messageIdentifier)
          ?.result
      : undefined;

    return previousMessage ? { ...thread, message: previousMessage } : thread;
  }

  async pendingDrafts(threadIdentifier: string) {
    const connection = this.store.syncState.read(threadIdentifier).connection;
    const profile = this.profile(connection);
    const records = await profile.drafts.list();

    return records.flatMap((record) => {
      const serialized = v.safeParse(v.string(), record.content);

      if (!serialized.success) return [];

      let input: unknown;

      try {
        input = JSON.parse(serialized.output);
      } catch {
        return [];
      }

      const prepared = v.safeParse(PreparedCommandSchema, input);

      if (
        !prepared.success ||
        prepared.output.operation.workspaceIdentifier !== connection.workspaceIdentifier ||
        prepared.output.operation.arguments.recordIdentifier !== connection.recordIdentifier
      )
        return [];

      if (
        record.status !== "draft" &&
        !isDeepStrictEqual(record.operation, prepared.output.operation)
      )
        throw new Error("Sync Thread saved draft does not match its immutable operation");

      return [{ ...record, content: serialized.output, operation: prepared.output.operation }];
    });
  }

  async discardDraft(threadIdentifier: string, draftIdentifier: string): Promise<void> {
    const draft = (await this.pendingDrafts(threadIdentifier)).find(
      (record) => record.draftIdentifier === draftIdentifier,
    );

    if (!draft) throw new DaemonError("not_found", "Sync Thread draft is unavailable");

    await this.profile(this.store.syncState.read(threadIdentifier).connection).drafts.discard(
      draft.draftIdentifier,
    );
  }

  async retryDraft(threadIdentifier: string, draftIdentifier: string) {
    this.assertEnabled(threadIdentifier);
    const records = await this.pendingDrafts(threadIdentifier);
    const draft = records.find((record) => record.draftIdentifier === draftIdentifier);

    if (!draft) throw new DaemonError("not_found", "Sync Thread draft is unavailable");

    if (draft.status === "rejected")
      throw new DaemonError(
        "sync_draft_rejected",
        "Rejected Sync Thread input requires an explicit edit and a new operation identity; its original input remains saved",
      );

    const prepared = v.parse(PreparedCommandSchema, JSON.parse(v.parse(v.string(), draft.content)));

    if (!isDeepStrictEqual(prepared.operation, draft.operation))
      throw new Error("Sync Thread saved draft does not match its immutable operation");

    if (draft.status === "draft")
      await this.profile(
        this.store.syncState.read(threadIdentifier).connection,
      ).drafts.markSubmitted({
        draftIdentifier: draft.draftIdentifier,
        operation: prepared.operation,
      });

    const connection = this.store.syncState.read(threadIdentifier).connection;
    const receipt = await lookupSyncThreadOperation({
      authorityURL: connection.authorityURL,
      authenticationToken: this.profile(connection).authenticationToken,
      operation: prepared.operation,
    });

    if (!receipt) await this.resume(threadIdentifier);

    return this.finishCommand(threadIdentifier, draft.draftIdentifier, prepared, receipt);
  }

  private async submitPreparedCommand(
    profile: ConnectedSyncThreadProfile,
    connection: SyncThreadConnection,
    prepared: v.InferOutput<typeof PreparedCommandSchema>,
  ) {
    if (prepared.kind === "staged") {
      await uploadSyncThreadCommand({
        authorityURL: connection.authorityURL,
        authenticationToken: profile.authenticationToken,
        upload: prepared.upload,
      });

      return submitSyncOperation({
        operation: prepared.operation,
        submit: (operation) =>
          profile.client.mutate(syncThreadMutators.thread.stagedCommand(operation)),
        lookup: (operation) =>
          lookupSyncThreadOperation({
            authorityURL: connection.authorityURL,
            authenticationToken: profile.authenticationToken,
            operation,
          }),
      });
    }

    return submitSyncOperation({
      operation: prepared.operation,
      submit: (operation) => profile.client.mutate(syncThreadMutators.thread.command(operation)),
      lookup: (operation) =>
        lookupSyncThreadOperation({
          authorityURL: connection.authorityURL,
          authenticationToken: profile.authenticationToken,
          operation,
        }),
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;

    for (const observation of this.observations.values()) observation.close();

    await Promise.all(
      [...this.profiles.values()].map(async (profile) => {
        await profile.close();
      }),
    );
    this.observations.clear();
    this.profiles.clear();
  }
}
