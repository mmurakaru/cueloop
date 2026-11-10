import * as v from "valibot";

const OriginSchema = v.pipe(
  v.string(),
  v.url(),
  v.check((value) => {
    const url = new URL(value);

    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  }, "Sync Thread endpoint must be an HTTP origin without credentials, query parameters, or a path"),
  v.transform((value) => new URL(value).origin),
);

export const SyncThreadConnectionSchema = v.strictObject({
  authorityURL: OriginSchema,
  cacheURL: OriginSchema,
  actorIdentifier: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  authenticationTokenEnvironment: v.pipe(v.string(), v.regex(/^[A-Za-z_][A-Za-z0-9_]*$/)),
  workspaceIdentifier: v.pipe(v.string(), v.uuid(), v.toLowerCase()),
  recordIdentifier: v.pipe(v.string(), v.uuid(), v.toLowerCase()),
});
export const SyncThreadImportConnectionSchema = v.omit(SyncThreadConnectionSchema, [
  "recordIdentifier",
]);

export type SyncThreadConnection = v.InferOutput<typeof SyncThreadConnectionSchema>;
