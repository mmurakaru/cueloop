import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as v from "valibot";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";

const CredentialSchema = v.union([
  v.object({
    type: v.literal("api_key"),
    key: v.optional(v.string()),
    env: v.optional(v.record(v.string(), v.string())),
  }),
  v.looseObject({
    type: v.literal("oauth"),
    refresh: v.string(),
    access: v.string(),
    expires: v.number(),
  }),
]);
const CredentialsSchema = v.record(v.string(), CredentialSchema);
const OwnerCredentialsSchema = v.record(v.string(), v.nullable(CredentialSchema));
const stores = new Map<string, CredentialStore>();

/** Model credentials stay outside the workspace execution environment. */
export function ownerCredentialStore(path: string, sourcePath?: string): CredentialStore {
  const existing = stores.get(path);

  if (existing) return existing;

  let changes = Promise.resolve();
  const readFile = (file: string): Record<string, Credential> =>
    existsSync(file) ? v.parse(CredentialsSchema, JSON.parse(readFileSync(file, "utf8"))) : {};
  const readOwner = (): Record<string, Credential | null> =>
    existsSync(path) ? v.parse(OwnerCredentialsSchema, JSON.parse(readFileSync(path, "utf8"))) : {};
  const read = (): Record<string, Credential> => {
    const credentials: Record<string, Credential | null> = sourcePath ? readFile(sourcePath) : {};

    Object.assign(credentials, readOwner());

    return Object.fromEntries(
      Object.entries(credentials).filter(
        (entry): entry is [string, Credential] => entry[1] !== null,
      ),
    );
  };
  const store: CredentialStore = {
    async read(providerId) {
      await changes;

      return read()[providerId];
    },
    async list() {
      await changes;

      return Object.entries(read()).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }));
    },
    modify(providerId, change) {
      const result = changes.then(async () => {
        const credentials = readOwner();
        const next = await change(read()[providerId]);

        if (next) credentials[providerId] = next;
        else credentials[providerId] = null;

        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomUUID()}.tmp`;

        writeFileSync(temporary, JSON.stringify(credentials), { mode: 0o600 });
        renameSync(temporary, path);

        return next;
      });

      changes = result.then(
        () => {},
        () => {},
      );

      return result;
    },
    async delete(providerId) {
      await store.modify(providerId, async () => undefined);
    },
  };

  stores.set(path, store);

  return store;
}
