import * as v from "valibot";
import type { ReadonlyJSONValue } from "@rocicorp/zero";

function isSyncJsonValue(input: unknown): input is ReadonlyJSONValue {
  const ancestors = new WeakSet<object>();

  function isSyncJsonNode(value: unknown): value is ReadonlyJSONValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;

    if (typeof value === "number") return Number.isFinite(value);

    if (typeof value !== "object") return false;

    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return false;

    if (ancestors.has(value)) return false;

    ancestors.add(value);

    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      if (!isSyncJsonNode(child)) return false;
    }

    ancestors.delete(value);

    return true;
  }

  return isSyncJsonNode(input);
}

export const SyncJsonValueSchema: v.GenericSchema<unknown, ReadonlyJSONValue> = v.pipe(
  v.custom<ReadonlyJSONValue>(
    isSyncJsonValue,
    "Sync JSON values require finite, acyclic plain JSON",
  ),
  v.transform((value) => structuredClone(value)),
);
