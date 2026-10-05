import * as v from "valibot";

const ThreadIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(128), v.brand("SdkThreadId"));
const OperationIdSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(128),
  v.brand("SdkOperationId"),
);
const SubmissionIdSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(128),
  v.brand("SdkSubmissionId"),
);

/** Thread, operation and submission IDs share a wire representation, not a domain type. */
export type SdkThreadId = v.InferOutput<typeof ThreadIdSchema>;
/** Operation IDs are caller-owned and persist across explicit retries. */
export type SdkOperationId = v.InferOutput<typeof OperationIdSchema>;
/** Submission IDs are minted by the daemon after accepting agent input. */
export type SdkSubmissionId = v.InferOutput<typeof SubmissionIdSchema>;

/** External Thread identities must be nonempty and at most 128 characters. */
export function createSdkThreadId(value: string): SdkThreadId {
  return v.parse(ThreadIdSchema, value);
}
/** Caller operation identities are stable across retries and at most 128 characters. */
export function createSdkOperationId(value: string): SdkOperationId {
  return v.parse(OperationIdSchema, value);
}
/** Submission identities are daemon-minted; parsing grants no capability. */
export function createSdkSubmissionId(value: string): SdkSubmissionId {
  return v.parse(SubmissionIdSchema, value);
}
