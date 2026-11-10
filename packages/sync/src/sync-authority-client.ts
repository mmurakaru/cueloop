import * as v from "valibot";
import {
  SyncAuthorityFenced,
  SyncWorkspaceAuthoritySchema,
  SyncAuthorityIdentitySchema,
  type SyncAuthorityIdentity,
} from "./sync-authority-protocol.ts";

/** Resolve the authority before opening a replica that could replay persistent native mutations. */
export async function fetchSyncWorkspaceAuthority(options: {
  authorityURL: string;
  workspaceIdentifier: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}) {
  const workspaceIdentifier = v.parse(
    SyncWorkspaceAuthoritySchema.entries.workspaceIdentifier,
    options.workspaceIdentifier,
  );
  const headers = new Headers(options.headers);

  headers.set("content-type", "application/json");
  const response = await fetch(
    new URL("authority", `${options.authorityURL.replace(/\/$/, "")}/`),
    {
      method: "POST",
      headers,
      body: JSON.stringify({ workspaceIdentifier }),
      redirect: "error",
      cache: "no-store",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    },
  );

  if (response.status === 503) throw new SyncAuthorityFenced();

  if (!response.ok) throw new Error(`Sync authority preflight failed with HTTP ${response.status}`);

  const authority = v.parse(SyncWorkspaceAuthoritySchema, await response.json());

  if (authority.workspaceIdentifier !== workspaceIdentifier)
    throw new Error("Sync authority preflight returned a different workspace");

  return authority;
}

export function syncAuthorityStorageKey(identity: SyncAuthorityIdentity, storageKey = "") {
  const authority = v.parse(SyncAuthorityIdentitySchema, {
    authorityIdentifier: identity.authorityIdentifier,
    generation: identity.generation,
  });

  return JSON.stringify([storageKey, authority.authorityIdentifier, authority.generation]);
}

/** Deployment identity permits cache recovery without granting access to any application record. */
export async function fetchSyncAuthority(options: {
  authorityURL: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}) {
  const headers = new Headers(options.headers);

  headers.set("content-type", "application/json");
  const response = await fetch(
    new URL("authority", `${options.authorityURL.replace(/\/$/, "")}/`),
    {
      method: "POST",
      headers,
      body: "{}",
      redirect: "error",
      cache: "no-store",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    },
  );

  if (response.status === 503) throw new SyncAuthorityFenced();

  if (!response.ok) throw new Error(`Sync authority preflight failed with HTTP ${response.status}`);

  return v.parse(SyncAuthorityIdentitySchema, await response.json());
}
