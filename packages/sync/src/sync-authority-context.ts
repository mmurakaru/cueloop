import type { Schema, ServerTransaction } from "@rocicorp/zero";
import type { SyncAuthorityIdentity } from "./sync-authority-protocol.ts";

export type SyncAuthorityTransaction = Pick<
  ServerTransaction<Schema, unknown>,
  "location" | "dbTransaction"
>;
const authorities = new WeakMap<object, SyncAuthorityIdentity>();

export function syncTransactionAuthority(
  transaction: SyncAuthorityTransaction,
): SyncAuthorityIdentity | undefined {
  return authorities.get(transaction.dbTransaction);
}

export async function withSyncAuthorityTransaction<Result>(
  transaction: SyncAuthorityTransaction,
  identity: SyncAuthorityIdentity,
  run: () => Result | Promise<Result>,
): Promise<Result> {
  authorities.set(transaction.dbTransaction, identity);

  try {
    return await run();
  } finally {
    authorities.delete(transaction.dbTransaction);
  }
}
