import { v7 as createOperationIdentifier } from "uuid";
import * as v from "valibot";
import serializeCanonicalJson from "canonicalize";
import type { ReadonlyJSONValue } from "@rocicorp/zero";
import { SyncJsonValueSchema } from "./sync-json.ts";

const MAXIMUM_OPERATION_BYTES = 512 * 1024;
const MAXIMUM_REQUEST_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;
const SyncOperationIdentifierSchema = v.pipe(
  v.string(),
  v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  v.toLowerCase(),
  v.brand("SyncOperationIdentifier"),
);
const SyncOperationMetadataEntries = {
  operationIdentifier: SyncOperationIdentifierSchema,
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(100), v.regex(/^[a-z][a-z0-9_.-]*$/)),
  version: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(2147483647)),
  workspaceIdentifier: v.pipe(v.string(), v.uuid(), v.toLowerCase()),
  createdAt: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(281474976710655)),
  expiresAt: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
};

const SyncOperationMetadataSchema = v.pipe(
  v.object(SyncOperationMetadataEntries),
  v.check(
    (operation) =>
      operation.expiresAt > operation.createdAt &&
      operation.expiresAt - operation.createdAt <= MAXIMUM_REQUEST_LIFETIME_MILLISECONDS,
    "Sync operation deadline must be within 24 hours of creation",
  ),
);

function operationSchema<ArgumentsSchema extends v.GenericSchema<unknown, ReadonlyJSONValue>>(
  argumentsSchema: ArgumentsSchema,
) {
  return v.intersect([SyncOperationMetadataSchema, v.object({ arguments: argumentsSchema })]);
}

export const SyncOperationSchema = operationSchema(SyncJsonValueSchema);

export type SyncOperationInput = v.InferInput<typeof SyncOperationSchema>;
export type SyncOperationIdentifier = v.InferOutput<typeof SyncOperationIdentifierSchema>;
export type SyncOperation<Arguments extends ReadonlyJSONValue = ReadonlyJSONValue> = Omit<
  v.InferOutput<typeof SyncOperationSchema>,
  "arguments"
> & { arguments: Arguments };

function checkOperationSize(operation: SyncOperation, maximumBytes: number) {
  v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAXIMUM_OPERATION_BYTES)),
    maximumBytes,
  );
  const serialized = JSON.stringify(operation);

  if (serialized === undefined) throw new Error("Sync operation must be serializable JSON");

  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new Error("Sync operation exceeds the configured byte limit");
  }
}

export function parseSyncOperation(
  input: SyncOperationInput,
  maximumBytes = MAXIMUM_OPERATION_BYTES,
): SyncOperation {
  const operation = v.parse(SyncOperationSchema, input);

  checkOperationSize(operation, maximumBytes);

  return operation;
}

type ReplayableArgumentsSchema<Definition extends v.GenericSchema> =
  v.InferOutput<Definition> extends v.InferInput<Definition> ? Definition : never;

export function defineSyncOperation<
  const Name extends string,
  const Version extends number,
  const ArgumentsSchema extends v.GenericSchema<unknown, ReadonlyJSONValue>,
>(options: {
  name: Name;
  version: Version;
  arguments: ArgumentsSchema & ReplayableArgumentsSchema<ArgumentsSchema>;
}) {
  v.parse(
    v.object({
      name: SyncOperationMetadataEntries.name,
      version: SyncOperationMetadataEntries.version,
    }),
    options,
  );
  const argumentsSchema = v.pipe(
    options.arguments,
    v.check((value) => {
      const parsed = v.safeParse(options.arguments, value);

      if (
        !parsed.success ||
        !v.is(SyncJsonValueSchema, value) ||
        !v.is(SyncJsonValueSchema, parsed.output)
      )
        return false;

      try {
        return serializeCanonicalJson(value) === serializeCanonicalJson(parsed.output);
      } catch {
        return false;
      }
    }, "Sync operation arguments must remain unchanged when their schema validates them again"),
  );
  const schema = v.intersect([
    operationSchema(argumentsSchema),
    v.object({
      name: v.literal(options.name),
      version: v.literal(options.version),
    }),
  ]);

  return {
    schema,
    create(input: {
      workspaceIdentifier: string;
      arguments: v.InferInput<ArgumentsSchema>;
      requestLifetimeMilliseconds?: number;
      maximumBytes?: number;
      now?: () => number;
    }) {
      const createdAt = input.now?.() ?? Date.now();
      const requestLifetime = v.parse(
        v.pipe(
          v.number(),
          v.safeInteger(),
          v.minValue(1),
          v.maxValue(MAXIMUM_REQUEST_LIFETIME_MILLISECONDS),
        ),
        input.requestLifetimeMilliseconds ?? 5 * 60 * 1000,
      );
      const operation = v.parse(schema, {
        operationIdentifier: createOperationIdentifier({ msecs: createdAt }),
        name: options.name,
        version: options.version,
        workspaceIdentifier: input.workspaceIdentifier,
        createdAt,
        expiresAt: createdAt + requestLifetime,
        arguments: input.arguments,
      });

      checkOperationSize(
        v.parse(SyncOperationSchema, operation),
        input.maximumBytes ?? MAXIMUM_OPERATION_BYTES,
      );

      return operation;
    },
    parse(input: SyncOperationInput, maximumBytes = MAXIMUM_OPERATION_BYTES) {
      const operation = v.parse(schema, input);

      checkOperationSize(v.parse(SyncOperationSchema, operation), maximumBytes);

      return operation;
    },
  };
}

export const SyncOperationRejectionSchema = v.object({
  code: v.pipe(v.string(), v.minLength(1), v.maxLength(100), v.regex(/^[a-z][a-z0-9_.-]*$/)),
  message: v.pipe(v.string(), v.minLength(1), v.maxLength(1000)),
});
const ReceiptMetadataEntries = {
  operationIdentifier: SyncOperationIdentifierSchema,
  workspaceIdentifier: SyncOperationMetadataEntries.workspaceIdentifier,
};

export const SyncOperationReceiptSchema = v.variant("status", [
  v.object({
    ...ReceiptMetadataEntries,
    status: v.literal("accepted"),
    acceptedAt: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    result: v.variant("status", [
      v.object({ status: v.literal("retained"), value: SyncJsonValueSchema }),
      v.object({ status: v.literal("expired") }),
    ]),
  }),
  v.object({
    ...ReceiptMetadataEntries,
    status: v.literal("rejected"),
    rejectedAt: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    reason: v.variant("status", [
      v.object({ status: v.literal("retained"), ...SyncOperationRejectionSchema.entries }),
      v.object({ status: v.literal("expired") }),
    ]),
  }),
]);

export type SyncOperationReceipt = v.InferOutput<typeof SyncOperationReceiptSchema>;

/** An application rejection rolls back its transactional changes and reserves the rejected identity. */
export class SyncOperationRejection extends Error {
  readonly code: string;

  constructor(reason: v.InferInput<typeof SyncOperationRejectionSchema>) {
    const validated = v.parse(SyncOperationRejectionSchema, reason);

    super(validated.message);
    this.name = "SyncOperationRejection";
    this.code = validated.code;
  }
}

/** A conflicting identity cannot represent a different application request. */
export class SyncOperationConflict extends Error {
  constructor() {
    super("Sync operation identity conflicts with an existing request");
    this.name = "SyncOperationConflict";
  }
}
