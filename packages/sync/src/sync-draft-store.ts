import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import { v7 as createDraftIdentifier } from "uuid";
import * as v from "valibot";
import type { StoreProvider } from "@rocicorp/zero/sqlite";
import type { ReadonlyJSONValue } from "@rocicorp/zero";
import { createSyncDraftStorage } from "./sync-draft-storage.ts";
import { SyncJsonValueSchema } from "./sync-json.ts";
import serializeCanonicalJson from "canonicalize";
import {
  SyncOperationSchema,
  SyncOperationReceiptSchema,
  parseSyncOperation,
  SyncOperationConflict,
  type SyncOperation,
  type SyncOperationReceipt,
} from "./sync-operation.ts";

const DraftContentEntries = {
  draftIdentifier: v.pipe(v.string(), v.uuid(), v.brand("SyncDraftIdentifier")),
  content: SyncJsonValueSchema,
  updatedAt: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
};
const SubmittedDraftEntries = { ...DraftContentEntries, operation: SyncOperationSchema };
export const SyncDraftRecordSchema = v.pipe(
  v.variant("status", [
    v.object({ ...DraftContentEntries, status: v.literal("draft") }),
    v.object({ ...SubmittedDraftEntries, status: v.literal("pending") }),
    v.object({
      ...SubmittedDraftEntries,
      status: v.literal("accepted"),
      receipt: v.optional(SyncOperationReceiptSchema.options[0]),
    }),
    v.object({
      ...SubmittedDraftEntries,
      status: v.literal("rejected"),
      receipt: v.optional(SyncOperationReceiptSchema.options[1]),
    }),
  ]),
  v.check(
    (record) =>
      record.status === "draft" ||
      record.status === "pending" ||
      record.receipt === undefined ||
      (record.operation.operationIdentifier === record.receipt.operationIdentifier &&
        record.operation.workspaceIdentifier === record.receipt.workspaceIdentifier),
    "Sync draft receipt must identify its saved operation",
  ),
);

export type SyncDraftRecord = v.InferOutput<typeof SyncDraftRecordSchema>;

/** Drafts have no submission side effects and are scoped to an authority and verified user identity. */
export function createSyncDraftStore(options: {
  storage: StoreProvider | "idb";
  authorityIdentifier: string;
  userIdentifier: string;
  maximumItems?: number;
  maximumBytes?: number;
  telemetry?: SyncTelemetry;
}) {
  const telemetry = options.telemetry ?? getSyncTelemetry();
  const scope = v.parse(
    v.object({
      authorityIdentifier: v.pipe(v.string(), v.minLength(1), v.maxLength(2000)),
      userIdentifier: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
    }),
    options,
  );
  const maximumItems = v.parse(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10000)),
    options.maximumItems ?? 1000,
  );
  const maximumBytes = v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(64 * 1024 * 1024)),
    options.maximumBytes ?? 8 * 1024 * 1024,
  );
  const parseRecords = (input: ReadonlyJSONValue): SyncDraftRecord[] => {
    const records = v.parse(v.array(SyncDraftRecordSchema), input);

    if (records.length > maximumItems) {
      telemetry.event("draft.queue", "overflow", { items: records.length });
      throw new Error("Sync draft store exceeds its item budget; retain the unsaved input");
    }

    return records;
  };
  const store = createSyncDraftStorage(
    options.storage,
    `cueloop-sync-drafts:${JSON.stringify(scope)}`,
  );
  const fitsBudget = (records: SyncDraftRecord[]): boolean => {
    const reserved = records.map((record) =>
      record.status === "pending"
        ? { ...record, status: "accepted", updatedAt: Number.MAX_SAFE_INTEGER }
        : record,
    );

    return new TextEncoder().encode(JSON.stringify(reserved)).byteLength <= maximumBytes;
  };
  const checkBudget = (records: SyncDraftRecord[]) => {
    if (!fitsBudget(records)) {
      telemetry.event("draft.queue", "overflow");
      throw new Error("Sync draft store exceeds its byte budget; retain the unsaved input");
    }
  };
  const replaceRecord = async (
    change: (records: SyncDraftRecord[]) => SyncDraftRecord,
  ): Promise<SyncDraftRecord> => {
    return store.update((current) => {
      const records = parseRecords(current ?? []);
      const record = change(records);
      const next = parseRecords([
        ...records.filter((existing) => existing.draftIdentifier !== record.draftIdentifier),
        record,
      ]);

      checkBudget(next);

      return { value: next, result: record };
    });
  };

  return {
    async list(): Promise<SyncDraftRecord[]> {
      const records = parseRecords((await store.read()) ?? []);

      checkBudget(records);

      return records;
    },
    async importRecords(input: readonly SyncDraftRecord[]): Promise<void> {
      const incoming = parseRecords(input);

      await store.update((current) => {
        const records = parseRecords(current ?? []);
        const merged = new Map(records.map((record) => [record.draftIdentifier, record]));

        for (const record of incoming) {
          const existing = merged.get(record.draftIdentifier);

          if (existing && serializeCanonicalJson(existing) !== serializeCanonicalJson(record))
            throw new Error("Sync draft import conflicts with an existing saved identity");

          merged.set(record.draftIdentifier, record);
        }

        const next = parseRecords([...merged.values()]);

        checkBudget(next);

        return { value: next, result: undefined };
      });
    },
    async save(input: {
      content: ReadonlyJSONValue;
      draftIdentifier?: SyncDraftRecord["draftIdentifier"];
    }): Promise<SyncDraftRecord> {
      const record = v.parse(SyncDraftRecordSchema, {
        draftIdentifier: input.draftIdentifier ?? createDraftIdentifier(),
        status: "draft",
        content: input.content,
        updatedAt: Date.now(),
      });

      return replaceRecord((records) => {
        const current = records.find(
          (existing) => existing.draftIdentifier === record.draftIdentifier,
        );

        if (current && current.status !== "draft")
          throw new Error("Sync draft has a saved operation; retain it until explicitly discarded");

        return record;
      });
    },
    async markSubmitted(input: {
      draftIdentifier: SyncDraftRecord["draftIdentifier"];
      operation: SyncOperation;
    }): Promise<SyncDraftRecord> {
      const operation = parseSyncOperation(input.operation);

      return replaceRecord((records) => {
        const current = records.find((record) => record.draftIdentifier === input.draftIdentifier);

        if (!current) throw new Error("Sync draft must be saved before its operation is submitted");

        if (current.status !== "draft") {
          if (serializeCanonicalJson(current.operation) !== serializeCanonicalJson(operation))
            throw new SyncOperationConflict();

          return current;
        }

        return v.parse(SyncDraftRecordSchema, {
          ...current,
          status: "pending",
          operation,
          updatedAt: Date.now(),
        });
      });
    },
    async recordReceipt(input: {
      draftIdentifier: SyncDraftRecord["draftIdentifier"];
      receipt: SyncOperationReceipt;
    }): Promise<SyncDraftRecord> {
      const receipt = v.parse(SyncOperationReceiptSchema, input.receipt);

      return replaceRecord((records) => {
        const current = records.find((record) => record.draftIdentifier === input.draftIdentifier);

        if (!current || current.status === "draft")
          throw new Error("Sync draft has no submitted operation to acknowledge");

        if (
          current.operation.operationIdentifier !== receipt.operationIdentifier ||
          current.operation.workspaceIdentifier !== receipt.workspaceIdentifier
        )
          throw new SyncOperationConflict();

        if (current.status !== "pending") {
          if (current.status !== receipt.status) throw new SyncOperationConflict();

          return current;
        }

        const completed = v.parse(SyncDraftRecordSchema, {
          ...current,
          status: receipt.status,
          receipt,
          updatedAt: Date.now(),
        });
        const next = [
          ...records.filter((record) => record.draftIdentifier !== completed.draftIdentifier),
          completed,
        ];

        if (fitsBudget(next)) return completed;

        return v.parse(SyncDraftRecordSchema, { ...completed, receipt: undefined });
      });
    },
    async discard(draftIdentifier: SyncDraftRecord["draftIdentifier"]): Promise<void> {
      await store.update((stored) => {
        const records = parseRecords(stored ?? []);
        const current = records.find((record) => record.draftIdentifier === draftIdentifier);

        if (current?.status === "pending")
          throw new Error(
            "Sync draft operation is still pending; recover its receipt before discarding it",
          );

        return {
          value: records.filter((record) => record.draftIdentifier !== draftIdentifier),
          result: undefined,
        };
      });
    },
    close: () => store.close(),
  };
}
