import { defineMutatorWithType } from "@cueloop/sync/schema";
import { assertSyncAuthorityOperation } from "@cueloop/sync/authority/server";
import { sharedRecordSchema } from "./workspace-schema.ts";
import {
  sharedRecordMutators,
  SharedRecordEditSchema,
  type SharedRecordContext,
} from "./shared-record.ts";

const defineRecordMutator = defineMutatorWithType<typeof sharedRecordSchema, SharedRecordContext>();

export const sharedRecordServerMutatorDefinitions = {
  edit: defineRecordMutator(SharedRecordEditSchema, async ({ tx, args, ctx }) => {
    if (tx.location !== "server")
      throw new Error("Shared record authority requires its server registry");

    await sharedRecordMutators.edit.fn({ tx, args, ctx });
    await assertSyncAuthorityOperation(tx, {
      workspaceIdentifier: args.authority.workspaceIdentifier,
      authority: args.authority,
    });
  }),
};
