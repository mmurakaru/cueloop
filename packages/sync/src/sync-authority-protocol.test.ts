import { SyncWorkspaceAuthoritySchema } from "./sync-authority-protocol.ts";
import { expect, test } from "bun:test";
import * as v from "valibot";
import { bindSyncOperationAuthority, defineSyncOperation } from "./sync-operation.ts";

const authority = v.parse(SyncWorkspaceAuthoritySchema, {
  authorityIdentifier: "019a691a-c6ae-7000-8000-000000000001",
  generation: "019a691a-c6ae-7000-8000-000000000002",
  workspaceIdentifier: "019a691a-c6ae-7000-8000-000000000003",
  workspaceGeneration: "019a691a-c6ae-7000-8000-000000000004",
});

test("an operation binds its authority generation before submission and cannot acquire a replacement generation", () => {
  const definition = defineSyncOperation({
    name: "record.append",
    version: 1,
    arguments: v.object({ content: v.string() }),
  });
  const original = definition.create({
    workspaceIdentifier: authority.workspaceIdentifier,
    arguments: { content: "Retain this uncertain request" },
  });
  const bound = bindSyncOperationAuthority(original, authority);

  expect(bound.authority).toEqual(authority);
  expect(bound.operationIdentifier).toBe(original.operationIdentifier);
  expect(original).not.toHaveProperty("authority");
  expect(bindSyncOperationAuthority(bound, authority)).toEqual(bound);
  expect(() =>
    bindSyncOperationAuthority(bound, {
      ...authority,
      generation: "019a691a-c6ae-7000-8000-000000000005",
    }),
  ).toThrow("identity");
});

test("an operation cannot claim an authority descriptor from another workspace", () => {
  const definition = defineSyncOperation({
    name: "record.append",
    version: 1,
    arguments: v.object({ content: v.string() }),
  });

  expect(() =>
    definition.create({
      workspaceIdentifier: "019a691a-c6ae-7000-8000-000000000006",
      authority,
      arguments: { content: "Wrong workspace" },
    }),
  ).toThrow("workspace");
});
